/**
 * End-to-end rendering with the real worker, Remotion, Chrome and FFmpeg: the API submits,
 * BullMQ delivers, the worker renders and post-processes, PostgreSQL records, files land in
 * storage, and every result is checked to be a playable video.
 *
 * Slow (a few minutes), so it only runs when asked:
 *
 *   RENDER_E2E=1 TEST_DATABASE_URL=… TEST_REDIS_URL=… pnpm --filter @statsopedia/api test render.e2e
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createFfmpegTools,
  createRemotionRenderer,
  orphanedBrowsers,
  parseProcessList,
  type VideoRenderer,
} from '@statsopedia/render-worker';
import {
  jobDetailResponseSchema,
  renderRequestDetailResponseSchema,
  renderSubmissionResponseSchema,
  videoProjectSchema,
} from '@statsopedia/shared-schemas';
import type { RenderJob, RenderRequest, VideoOutput } from '@statsopedia/shared-types';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  TEMPLATE_ID,
  createHarness,
  integrationEnabled,
  logger,
  startWorker,
  DATABASE_URL,
  REDIS_URL,
  type Harness,
} from './harness.js';

const enabled = integrationEnabled && process.env.RENDER_E2E === '1';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY_POINT = path.join(ROOT, 'apps/renderer/src/index.ts');
const WORKER_ENTRY = path.join(ROOT, 'services/render-worker/dist/index.js');
const CSV = 'entity_id,entity_name,year,value,unit,source_id\nA,Alpha,2015,1,units,s\n';
const media = createFfmpegTools();

describe.skipIf(!enabled)('rendering end to end (Remotion, Chrome, FFmpeg)', () => {
  let h: Harness;
  let editor: ReturnType<typeof request.agent>;
  let datasetVersionId: string;
  let musicId: string;
  let downloads: string;
  let renderer: VideoRenderer;
  let workers: Awaited<ReturnType<typeof startWorker>>[] = [];
  let children: ChildProcess[] = [];

  /** Short videos: 6 periods at "fast" speed, no intro, a one-second outro, 720p at 24 fps. */
  async function createProject(overrides: Record<string, unknown> = {}) {
    const response = await editor
      .post('/api/projects')
      .send({
        name: 'E2E ranking',
        configuration: {
          datasetVersionId,
          templateId: TEMPLATE_ID,
          title: 'End-to-end ranking',
          outputMode: 'both',
          animationSpeed: 'fast',
          resolution: '720p',
          fps: 24,
          intro: { enabled: false, durationSeconds: 1, title: null, subtitle: null },
          outro: { enabled: true, durationSeconds: 1, text: 'Thanks for watching' },
          music: {
            assetId: musicId,
            volume: 0.5,
            fadeInSeconds: 0.5,
            fadeOutSeconds: 0.5,
            loop: true,
          },
          ...overrides,
        },
      })
      .expect(201);
    return videoProjectSchema.parse(response.body);
  }

  async function submit(projectId: string, kind: 'render' | 'preview', body: object = {}) {
    const response = await editor.post(`/api/projects/${projectId}/${kind}`).send(body).expect(202);
    return renderSubmissionResponseSchema.parse(response.body).request;
  }

  async function job(id: string): Promise<RenderJob> {
    return jobDetailResponseSchema.parse((await editor.get(`/api/jobs/${id}`).expect(200)).body)
      .job;
  }

  async function waitForJob(id: string, done: (job: RenderJob) => boolean, timeout = 180_000) {
    let latest: RenderJob | undefined;
    await vi.waitFor(
      async () => {
        latest = await job(id);
        if (!done(latest)) throw new Error(`${latest.status} ${latest.percent}% ${latest.message}`);
      },
      { timeout, interval: 250 },
    );
    return latest!;
  }

  async function waitForRequest(id: string, timeout = 240_000): Promise<RenderRequest> {
    let latest: RenderRequest | undefined;
    await vi.waitFor(
      async () => {
        latest = renderRequestDetailResponseSchema.parse(
          (await editor.get(`/api/renders/${id}`).expect(200)).body,
        ).request;
        if (latest.jobs.some((j) => !['completed', 'failed', 'cancelled'].includes(j.status))) {
          throw new Error(`${latest.status} ${latest.percent}%`);
        }
      },
      { timeout, interval: 500 },
    );
    return latest!;
  }

  /** Downloads an output through the API and checks it is a complete, playable video. */
  async function expectPlayable(output: VideoOutput, size: [number, number]) {
    const response = await editor.get(output.downloadUrl).expect(200);
    const file = path.join(downloads, `${output.id}.mp4`);
    await writeFile(file, response.body as Buffer);
    const probe = await media.probe(file);
    expect(probe.video).toMatchObject({ codec: 'h264', pixelFormat: 'yuv420p', fps: 24 });
    expect([probe.video!.width, probe.video!.height]).toEqual(size);
    expect(probe.video!.frames).toBe(Math.round(output.durationSeconds * 24));
    expect(probe.audio).toMatchObject({ codec: 'aac' }); // the music track
    expect(await media.isFaststart(file)).toBe(true);
    await media.verifyDecodes(file); // every frame and sample decodes
    expect(output.metadata).toMatchObject({
      faststart: true,
      durationInFrames: probe.video!.frames,
    });
    expect(output.metadata!.audio!.integratedLufs).toEqual(expect.any(Number));
    // Measured on the encoded file: audible, not clipped, faded in and out.
    expect(output.metadata!.qualityChecks.map((check) => [check.id, check.status])).toEqual([
      ['music_audible', 'pass'],
      ['music_clipping', 'pass'],
      ['music_fades', 'pass'],
    ]);
    await editor.get(output.thumbnailUrl!).expect(200).expect('content-type', 'image/jpeg');
  }

  const outputOf = async (jobId: string) =>
    jobDetailResponseSchema.parse((await editor.get(`/api/jobs/${jobId}`).expect(200)).body)
      .output!;

  beforeAll(async () => {
    h = await createHarness({ mediaUploadBytes: 16 * 1024 * 1024 });
    editor = request.agent(h.app).set(h.auth('editor'));
    downloads = await mkdtemp(path.join(os.tmpdir(), 'statsopedia-e2e-'));
    const dataset = await editor.post('/api/datasets').send({ title: 'E2E fixture' }).expect(201);
    const imported = await editor
      .post(`/api/datasets/${(dataset.body as { id: string }).id}/import`)
      .query({ filename: 'data.csv' })
      .set('content-type', 'text/csv')
      .send(Buffer.from(CSV))
      .expect(201);
    datasetVersionId = (imported.body as { version: { id: string } }).version.id;
    const pad = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(ROOT, 'apps/renderer/public/audio/statsopedia-synthetic-pad.wav')),
    );
    const music = await editor
      .post('/api/media')
      .query({
        type: 'music',
        filename: 'pad.wav',
        category: 'ambient',
        licenseType: 'original',
        license: 'CC0-1.0',
        commercialUse: 'true',
      })
      .send(pad)
      .expect(201);
    musicId = (music.body as { id: string }).id;
    renderer = createRemotionRenderer({
      entryPoint: ENTRY_POINT,
      logger,
      concurrency: null,
      frameTimeoutMs: 60_000,
      binariesDirectory: null,
    });
    await renderer.warmUp(); // bundle once for the in-process workers
  }, 300_000);

  afterEach(async () => {
    await Promise.all(workers.map((worker) => worker.close({ force: true })));
    workers = [];
    for (const child of children) killGroup(child);
    children = [];
  });

  afterAll(async () => {
    await h?.close();
    await rm(downloads, { recursive: true, force: true });
  });

  const start = async (wrap?: (renderer: VideoRenderer) => VideoRenderer) => {
    const worker = await startWorker(h, { renderer: wrap ? wrap(renderer) : renderer, media });
    workers.push(worker);
    return worker;
  };

  it('renders a preview', async () => {
    await start();
    const project = await createProject({ outputMode: 'short' });
    const preview = await submit(project.id, 'preview');
    const done = await waitForRequest(preview.id);
    expect(done.status).toBe('completed');
    const output = await outputOf(done.jobs[0]!.id);
    expect(output.metadata).toMatchObject({ gl: 'default' });
    await expectPlayable(output, [720, 1280]);
  }, 300_000);

  it('renders long-form and Shorts from one project, deterministically', async () => {
    await start();
    const project = await createProject();
    const both = await submit(project.id, 'render');
    expect(both.type).toBe('both');
    const done = await waitForRequest(both.id);
    expect(done).toMatchObject({ status: 'completed', percent: 100 });
    const [long, short] = await Promise.all(done.jobs.map((j) => outputOf(j.id)));
    expect(long!.metadata).toMatchObject({ gl: 'swangle' });
    await expectPlayable(long!, [1280, 720]);
    await expectPlayable(short!, [720, 1280]);

    // Final renders are reproducible: the same input renders to the same bytes.
    const again = await submit(project.id, 'render', { formats: ['long'] });
    const repeated = await waitForRequest(again.id);
    expect((await outputOf(repeated.jobs[0]!.id)).checksumSha256).toBe(long!.checksumSha256);
    const files = await readdir(h.storage.resolve('renders/long'));
    expect(files.toSorted()).toEqual(
      [
        `${project.id}_long_v${both.renderVersion}.mp4`,
        `${project.id}_long_v${again.renderVersion}.mp4`,
      ].toSorted(),
    );
  }, 600_000);

  it('cancels an active render and leaves nothing behind', async () => {
    await start();
    const project = await createProject({ outputMode: 'long' });
    const { jobs } = await submit(project.id, 'render');
    await waitForJob(jobs[0]!.id, (j) => j.status === 'rendering' && j.percent >= 15);
    await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200);
    const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'cancelled', 30_000);
    expect(done.outputId).toBeNull();
    expect(await readdir(h.storage.resolve('temp/renders'))).toEqual([]);
    expect(await readdir(h.storage.resolve('renders/long'))).not.toContain(
      `${project.id}_long_v${jobs[0]!.renderVersion}.mp4`,
    );
  }, 300_000);

  it('retries a render that crashed and completes it', async () => {
    let failures = 0;
    await start((real) => ({
      ...real,
      async renderVideo(options) {
        if (failures++ === 0) {
          // Stop part-way through, like a crashed browser.
          const crash = new AbortController();
          await real.renderVideo({
            ...options,
            signal: AbortSignal.any([options.signal, crash.signal]),
            onProgress: (progress) => {
              options.onProgress(progress);
              if (progress.renderedFrames > 20) crash.abort();
            },
          });
        }
        return real.renderVideo(options);
      },
    }));
    const project = await createProject({ outputMode: 'short' });
    const preview = await submit(project.id, 'preview');
    const done = await waitForRequest(preview.id);
    expect(done.jobs[0]).toMatchObject({ status: 'completed', attempts: 2 });
    const detail = jobDetailResponseSchema.parse(
      (await editor.get(`/api/jobs/${done.jobs[0]!.id}`)).body,
    );
    expect(detail.events.some((e) => /Attempt 1 of 2 failed/.test(e.message))).toBe(true);
    await expectPlayable(detail.output!, [720, 1280]);
  }, 300_000);

  it('recovers a render after the worker process is killed', async () => {
    const project = await createProject({ outputMode: 'long' });
    const { jobs } = await submit(project.id, 'render');
    const first = spawnWorker(h);
    children.push(first);
    await waitForJob(jobs[0]!.id, (j) => j.status === 'rendering' && j.percent >= 15);
    killGroup(first); // like a power cut: no clean-up, no hand-back
    const second = spawnWorker(h);
    children.push(second);
    const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'completed', 240_000);
    expect(done.attempts).toBe(1);
    const detail = jobDetailResponseSchema.parse(
      (await editor.get(`/api/jobs/${jobs[0]!.id}`)).body,
    );
    expect(detail.events.map((e) => e.message)).toContain(
      'The render worker stopped responding; the job will be retried',
    );
    await expectPlayable(detail.output!, [1280, 720]);
    expect(await readdir(h.storage.resolve('temp/renders'))).toEqual([]);
    // The killed worker's browser was reaped by the next worker at start-up.
    const { stdout } = await promisify(execFile)('ps', ['-eo', 'pid=,ppid=,pgid=,command=']);
    expect(orphanedBrowsers(parseProcessList(stdout))).toEqual([]);
  }, 360_000);
});

/** The render worker as its own process (own process group, so Chrome dies with it). */
function spawnWorker(h: Harness): ChildProcess {
  const database = new URL(DATABASE_URL!);
  database.searchParams.set('options', `-c search_path=${h.schema}`);
  return spawn(process.execPath, [WORKER_ENTRY], {
    cwd: os.tmpdir(), // no .env there: the worker gets exactly the variables below
    detached: true,
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      REDIS_URL: REDIS_URL,
      DATABASE_URL: database.toString(),
      STORAGE_ROOT: h.storageRoot,
      RENDERER_ENTRY_POINT: ENTRY_POINT,
      QUEUE_PREFIX: h.prefix,
      LOCK_DURATION_SECONDS: '3',
      STALLED_INTERVAL_SECONDS: '1',
    },
  });
}

function killGroup(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone
  }
}
