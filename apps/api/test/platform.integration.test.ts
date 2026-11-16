/**
 * Auth, catalogue, projects and persistent render orchestration against real PostgreSQL and
 * Redis/BullMQ, with the real render worker runtime (pipeline, processor, lifecycle) running
 * in-process. Only Remotion and FFmpeg are replaced (see FakeRenderer in harness.ts); the
 * real-Remotion suite is render.e2e.test.ts.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import { payloadFor } from '../src/render/orchestrator.js';
import * as store from '@statsopedia/render-store';
import {
  jobDetailResponseSchema,
  loginResponseSchema,
  projectDetailResponseSchema,
  renderRequestDetailResponseSchema,
  renderSubmissionResponseSchema,
  videoProjectSchema,
} from '@statsopedia/shared-schemas';
import {
  RENDER_CANCEL_KEY_PREFIX,
  RENDER_JOB_STATUSES,
  canTransitionRenderJob,
  type RenderJob,
  type RenderRequest,
  type VideoProject,
} from '@statsopedia/shared-types';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  FakeRenderer,
  PASSWORD,
  TEMPLATE_ID,
  createHarness,
  integrationEnabled,
  startWorker,
  type Harness,
  type RenderBehaviour,
} from './harness.js';

const CSV = 'entity_id,entity_name,year,value,unit,source_id\nA,Alpha,2015,1,units,s\n';
const errorCode = (body: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe.skipIf(!integrationEnabled)('platform (PostgreSQL + Redis/BullMQ)', () => {
  let h: Harness;
  let editor: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let datasetVersionId: string;
  let workers: Awaited<ReturnType<typeof startWorker>>[] = [];

  async function startWorkers(behaviour: RenderBehaviour = 'succeed', options = {}) {
    const renderer = new FakeRenderer();
    renderer.behaviour = behaviour;
    const worker = await startWorker(h, { renderer, ...options });
    workers.push(worker);
    return worker;
  }

  async function stopWorkers() {
    await Promise.all(workers.map((worker) => worker.close({ force: true })));
    workers = [];
  }

  /** One second of silent 16-bit mono WAV at 44.1 kHz. */
  /** Mono 16-bit 8 kHz WAV: a 220 Hz tone at `amplitude` (0 = silence). */
  function wav(seconds: number, amplitude = 0.25): Buffer {
    const rate = 8_000;
    const samples = Math.round(seconds * rate);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(36 + samples * 2, 4);
    header.write('WAVEfmt ', 8, 'latin1');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'latin1');
    header.writeUInt32LE(samples * 2, 40);
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      data.writeInt16LE(
        Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32_767),
        i * 2,
      );
    }
    return Buffer.concat([header, data]);
  }

  /** Query of a music upload with complete licensing. */
  const musicQuery = (overrides: Record<string, string> = {}) => ({
    type: 'music',
    filename: 'pad.wav',
    category: 'ambient',
    licenseType: 'public_domain',
    license: 'CC0-1.0',
    commercialUse: 'true',
    ...overrides,
  });

  async function createProject(overrides: Record<string, unknown> = {}): Promise<VideoProject> {
    const response = await editor
      .post('/api/projects')
      .send({
        name: `Project ${randomUUID().slice(0, 6)}`,
        configuration: {
          datasetVersionId,
          templateId: TEMPLATE_ID,
          outputMode: 'both',
          ...overrides,
        },
      })
      .expect(201);
    return videoProjectSchema.parse(response.body);
  }

  async function waitForJob(id: string, done: (job: RenderJob) => boolean): Promise<RenderJob> {
    let job: RenderJob | undefined;
    await vi.waitFor(
      async () => {
        const response = await editor.get(`/api/jobs/${id}`).expect(200);
        job = jobDetailResponseSchema.parse(response.body).job;
        if (!done(job)) {
          const { status, percent, attempts, message, errorCode: code, errorMessage } = job;
          throw new Error(
            `Job not there yet: ${JSON.stringify({ status, percent, attempts, message, code, errorMessage })}`,
          );
        }
      },
      { timeout: 15_000, interval: 100 },
    );
    return job!;
  }

  beforeAll(async () => {
    h = await createHarness();
    editor = request.agent(h.app).set(h.auth('editor'));
    viewer = request.agent(h.app).set(h.auth('viewer'));
    const dataset = await editor
      .post('/api/datasets')
      .send({ title: 'Ranking fixture' })
      .expect(201);
    const imported = await editor
      .post(`/api/datasets/${(dataset.body as { id: string }).id}/import`)
      .query({ filename: 'data.csv' })
      .set('content-type', 'text/csv')
      .send(Buffer.from(CSV))
      .expect(201);
    datasetVersionId = (imported.body as { version: { id: string } }).version.id;
  });

  afterEach(async () => {
    await stopWorkers();
    // Cancel what a test left unfinished, so later tests' workers do not pick it up first.
    const { rows } = await h.pool.query<{ id: string }>(
      `SELECT id FROM render_jobs WHERE status IN ${store.ACTIVE_STATUS_SQL}`,
    );
    for (const { id } of rows) await editor.post(`/api/jobs/${id}/cancel`);
  });

  afterAll(async () => {
    await h?.close();
  });

  // ─── Authentication ────────────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('logs in, identifies the user and logs out', async () => {
      const login = await request(h.app)
        .post('/api/auth/login')
        .send({ email: 'ADMIN@example.com', password: PASSWORD })
        .expect(200);
      const { token, user } = loginResponseSchema.parse(login.body);
      expect(user).toMatchObject({ email: 'admin@example.com', role: 'admin' });
      expect(JSON.stringify(login.body)).not.toMatch(/scrypt|password/i);

      const me = await request(h.app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((me.body as { user: { id: string } }).user.id).toBe(user.id);

      await request(h.app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      await request(h.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects bad credentials identically and requires a session everywhere', async () => {
      const wrong = await request(h.app)
        .post('/api/auth/login')
        .send({ email: 'editor@example.com', password: 'wrong password!!' })
        .expect(401);
      const unknown = await request(h.app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong password!!' })
        .expect(401);
      expect(wrong.body).toEqual(unknown.body);
      await request(h.app).post('/api/auth/login').send({ email: 'x' }).expect(400);

      for (const path of [
        '/api/datasets',
        '/api/topics',
        '/api/projects',
        '/api/templates',
        '/api/media',
      ]) {
        const response = await request(h.app).get(path).expect(401);
        expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
      }
      await request(h.app)
        .get('/api/topics')
        .set('Authorization', 'Bearer not-a-real-token-000000')
        .expect(401);
      await request(h.app).get('/health').expect(200); // health stays public
    });

    it('limits login attempts per account', async () => {
      const attempt = () =>
        request(h.app)
          .post('/api/auth/login')
          .send({ email: 'limited@example.com', password: 'x' });
      for (let i = 0; i < 10; i++) await attempt().expect(401);
      const limited = await attempt().expect(429);
      expect(limited.headers['retry-after']).toBeDefined();
    });

    it('lets viewers read but not write', async () => {
      await viewer.get('/api/projects').expect(200);
      const denied = await viewer.post('/api/topics').send({ name: 'Nope' }).expect(403);
      expect(errorCode(denied.body)).toBe('FORBIDDEN');
      await viewer.post('/api/datasets').send({ title: 'Nope' }).expect(403);
    });
  });

  // ─── Catalogue ─────────────────────────────────────────────────────────────────────────────

  describe('topics, templates and media', () => {
    it('creates and lists topics with unique slugs', async () => {
      const created = await editor
        .post('/api/topics')
        .send({ name: 'Space Exploration' })
        .expect(201);
      expect(created.body).toMatchObject({ slug: 'space-exploration' });
      await editor.post('/api/topics').send({ name: 'Space Exploration' }).expect(409);
      const list = await viewer.get('/api/topics').expect(200);
      expect((list.body as { topics: { slug: string }[] }).topics.map((t) => t.slug)).toContain(
        'space-exploration',
      );
    });

    it('lists active templates with their version', async () => {
      const response = await viewer.get('/api/templates').expect(200);
      expect((response.body as { templates: unknown[] }).templates[0]).toMatchObject({
        id: TEMPLATE_ID,
        version: 1,
        compositionId: 'BarChartRace',
        supportedFormats: ['long', 'short'],
      });
    });

    it('accepts media by content type sniffing and serves it without exposing paths', async () => {
      const tone = wav(6);
      const upload = await editor
        .post('/api/media')
        .query(musicQuery({ filename: '../../pad.wav' }))
        .send(tone)
        .expect(201);
      expect(upload.body).toMatchObject({
        type: 'music',
        name: 'pad.wav',
        mimeType: 'audio/wav',
        fileFormat: 'wav',
        durationSeconds: 6,
        category: 'ambient',
        licenseType: 'public_domain',
        license: 'CC0-1.0',
        commercialUse: true,
        attributionRequired: false,
        audio: { codec: 'pcm_s16le', sampleRate: 8_000, channels: 1 },
      });
      // A 0.25 sine peaks near −12 dBFS.
      const { audio } = upload.body as { audio: { truePeakDbtp: number; integratedLufs: number } };
      expect(audio.truePeakDbtp).toBeGreaterThan(-13);
      expect(audio.truePeakDbtp).toBeLessThan(-11);
      expect(audio.integratedLufs).toBeLessThan(-10);
      expect(JSON.stringify(upload.body)).not.toMatch(/assets\//);
      const id = (upload.body as { id: string }).id;
      const file = await viewer.get(`/api/media/${id}/file`).expect(200);
      expect(file.headers['content-type']).toBe('audio/wav');

      await editor.post('/api/media').query(musicQuery()).send(Buffer.from('<svg/>')).expect(415);
      await editor
        .post('/api/media')
        .query({ type: 'logo', filename: 'x.png' })
        .send(tone)
        .expect(415);
      await viewer.post('/api/media').query(musicQuery()).send(tone).expect(403);
    });

    it('validates music: decodable, long enough, not silent, with its licensing recorded', async () => {
      const refused = async (query: Record<string, string>, body: Buffer, code: string) => {
        const response = await editor.post('/api/media').query(query).send(body);
        expect(errorCode(response.body)).toBe(code);
      };
      await refused(musicQuery(), wav(2), 'INVALID_AUDIO_LENGTH');
      await refused(musicQuery(), wav(6, 0), 'SILENT_AUDIO');
      // Looks like an MP3 (ID3 tag) but is not one.
      await refused(
        musicQuery({ filename: 'x.mp3' }),
        Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4_000, 7)]),
        'INVALID_AUDIO',
      );
      await refused({ type: 'music', filename: 'x.wav' }, wav(6), 'VALIDATION_ERROR');
      await refused(musicQuery({ attributionRequired: 'true' }), wav(6), 'VALIDATION_ERROR');
      // Nothing refused is kept.
      const list = await editor.get('/api/media').query({ type: 'music', category: 'ambient' });
      for (const asset of (list.body as { assets: { durationSeconds: number }[] }).assets) {
        expect(asset.durationSeconds).toBe(6);
      }
    });

    it('corrects licensing metadata, keeping the credit line consistent', async () => {
      const upload = await editor.post('/api/media').query(musicQuery()).send(wav(6)).expect(201);
      const id = (upload.body as { id: string }).id;
      const missing = await editor
        .patch(`/api/media/${id}`)
        .send({ attributionRequired: true })
        .expect(422);
      expect(errorCode(missing.body)).toBe('ATTRIBUTION_TEXT_REQUIRED');
      const updated = await editor
        .patch(`/api/media/${id}`)
        .send({
          licenseType: 'creative_commons',
          license: 'CC BY 4.0',
          attributionRequired: true,
          attribution: 'Pad by Example (CC BY 4.0)',
          licenseReference: 'https://creativecommons.org/licenses/by/4.0/',
          category: 'cinematic',
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        category: 'cinematic',
        attributionRequired: true,
        attribution: 'Pad by Example (CC BY 4.0)',
      });
      await editor.patch(`/api/media/${id}`).send({ checksumSha256: 'x' }).expect(400);
      await viewer.patch(`/api/media/${id}`).send({ name: 'y' }).expect(403);
    });
  });

  // ─── Projects ──────────────────────────────────────────────────────────────────────────────

  describe('projects', () => {
    it('creates a project pinned to an immutable dataset version, with defaults', async () => {
      const project = await createProject();
      expect(project).toMatchObject({
        status: 'draft',
        datasetVersionId,
        templateId: TEMPLATE_ID,
        templateVersion: 1,
        revision: 1,
        configuration: {
          title: 'Ranking fixture',
          outputMode: 'both',
          topN: 10,
          unitLabel: 'units',
        },
      });
    });

    it('validates references, periods and formats before saving', async () => {
      const bad = async (configuration: Record<string, unknown>, status: number, code: string) => {
        const response = await editor
          .post('/api/projects')
          .send({
            name: 'x',
            configuration: { datasetVersionId, templateId: TEMPLATE_ID, ...configuration },
          })
          .expect(status);
        expect(errorCode(response.body)).toBe(code);
      };
      await bad({ datasetVersionId: randomUUID() }, 422, 'UNKNOWN_DATASET_VERSION');
      await bad({ templateId: randomUUID() }, 422, 'UNKNOWN_TEMPLATE');
      await bad({ startPeriod: '1999' }, 422, 'UNKNOWN_PERIOD');
      await bad({ startPeriod: '2020', endPeriod: '2015' }, 422, 'INVALID_PERIOD_RANGE');
      await bad(
        {
          music: {
            assetId: randomUUID(),
            volume: 0.5,
            fadeInSeconds: 1,
            fadeOutSeconds: 1,
            loop: true,
          },
        },
        422,
        'UNKNOWN_MUSIC',
      );
      await bad({ topN: 50 }, 400, 'VALIDATION_ERROR');
      await bad({ outputFormats: ['long'] }, 400, 'VALIDATION_ERROR');
    });

    it('refuses dataset versions that are not ready', async () => {
      const dataset = await editor.post('/api/datasets').send({ title: 'Broken data' }).expect(201);
      const invalid = await editor
        .post(`/api/datasets/${(dataset.body as { id: string }).id}/import`)
        .query({ filename: 'bad.csv' })
        .set('content-type', 'text/csv')
        .send(Buffer.from(`${CSV}B,Beta,2016,abc,units,s\n`))
        .expect(201);
      const response = await editor
        .post('/api/projects')
        .send({
          name: 'x',
          configuration: {
            datasetVersionId: (invalid.body as { version: { id: string } }).version.id,
            templateId: TEMPLATE_ID,
          },
        })
        .expect(409);
      expect(errorCode(response.body)).toBe('VERSION_NOT_READY');
    });

    it('updates with optimistic locking', async () => {
      const project = await createProject();
      const update = {
        revision: 1,
        name: 'Renamed',
        topicId: null,
        configuration: { ...project.configuration, topN: 5 },
      };
      const updated = await editor.put(`/api/projects/${project.id}`).send(update).expect(200);
      expect(updated.body).toMatchObject({
        name: 'Renamed',
        revision: 2,
        configuration: { topN: 5 },
      });
      const stale = await editor.put(`/api/projects/${project.id}`).send(update).expect(409);
      expect(errorCode(stale.body)).toBe('REVISION_CONFLICT');
    });
  });

  // ─── Rendering ─────────────────────────────────────────────────────────────────────────────

  describe('render orchestration', () => {
    async function submit(projectId: string, path: 'render' | 'preview', body: object = {}) {
      const response = await editor
        .post(`/api/projects/${projectId}/${path}`)
        .send(body)
        .expect(202);
      return renderSubmissionResponseSchema.parse(response.body).request;
    }

    async function waitForRequest(
      id: string,
      done: (request: RenderRequest) => boolean,
    ): Promise<RenderRequest> {
      let latest: RenderRequest | undefined;
      await vi.waitFor(
        async () => {
          latest = renderRequestDetailResponseSchema.parse(
            (await editor.get(`/api/renders/${id}`).expect(200)).body,
          ).request;
          if (!done(latest))
            throw new Error(`Request not there yet: ${latest.status} ${latest.percent}%`);
        },
        { timeout: 15_000, interval: 100 },
      );
      return latest!;
    }

    const tempDirectories = () => readdir(h.storage.resolve('temp/renders')).catch(() => []);

    it('renders both formats from one project as two independently tracked outputs', async () => {
      await startWorkers();
      const project = await createProject();
      const submitted = await submit(project.id, 'render');
      expect(submitted).toMatchObject({ type: 'both', kind: 'final', formats: ['long', 'short'] });
      expect(submitted.jobs.map((job) => job.outputFormat)).toEqual(['long', 'short']);
      expect(new Set(submitted.jobs.map((job) => job.renderVersion))).toEqual(
        new Set([submitted.renderVersion]),
      );

      const done = await waitForRequest(submitted.id, (r) => r.status === 'completed');
      expect(done.percent).toBe(100);
      for (const job of done.jobs) {
        expect(job).toMatchObject({ status: 'completed', percent: 100, attempts: 1 });
        const detail = jobDetailResponseSchema.parse(
          (await editor.get(`/api/jobs/${job.id}`)).body,
        );
        expect(detail.manifest).toMatchObject({
          compositionId: 'BarChartRace',
          templateVersion: 1,
          datasetVersionId,
        });
        expect(detail.manifest.raceConfig.outputFormat).toBe(job.outputFormat);
        // Every stage of the lifecycle is in the render log, in order.
        const statuses = [...new Set(detail.events.map((e) => e.status))];
        expect(statuses).toEqual([
          'pending',
          'validating',
          'preparing',
          'rendering',
          'post_processing',
          'completed',
        ]);
        expect(JSON.stringify(detail)).not.toMatch(/renders\/|storage|temp\/|logs\//);

        const output = await editor.get(`/api/outputs/${job.outputId}`).expect(200);
        expect(output.body).toMatchObject({
          format: job.outputFormat,
          renderVersion: submitted.renderVersion,
          downloadUrl: `/api/outputs/${job.outputId}/download`,
          metadata: {
            attempt: 1,
            gl: 'swangle',
            faststart: true,
            audio: { integratedLufs: -18.5 },
            timingsMs: { total: expect.any(Number) as number },
          },
        });
        // File names come from the project id, format and render version: never a title.
        const stored = await store.getOutput(h.pool, job.outputId!);
        expect(stored!.storageKey).toBe(
          `renders/${job.outputFormat === 'long' ? 'long' : 'shorts'}/${project.id}_${job.outputFormat}_v${submitted.renderVersion}.mp4`,
        );
        expect(stored!.thumbnailKey).toBe(
          `thumbnails/${project.id}_${job.outputFormat}_v${submitted.renderVersion}.jpg`,
        );
        const log = await h.storage.read(
          `logs/${project.id}_${job.outputFormat}_v${submitted.renderVersion}.log`,
        );
        expect(log.toString()).toMatch(/"status":"completed"/);

        const download = await viewer.get(`/api/outputs/${job.outputId}/download`).expect(200);
        expect(download.headers['content-type']).toBe('video/mp4');
        expect(
          createHash('sha256')
            .update(download.body as Buffer)
            .digest('hex'),
        ).toBe((output.body as { checksumSha256: string }).checksumSha256);
        const partial = await viewer
          .get(`/api/outputs/${job.outputId}/download`)
          .set('Range', 'bytes=0-3')
          .expect(206);
        expect((partial.body as Buffer).toString()).toBe('fake');
        await viewer.get(`/api/outputs/${job.outputId}/thumbnail`).expect(200);
      }
      expect(await tempDirectories()).toEqual([]);
      const detail = projectDetailResponseSchema.parse(
        (await editor.get(`/api/projects/${project.id}`)).body,
      );
      expect(detail.project.status).toBe('rendered');
      expect(detail.outputs).toHaveLength(2);
      expect(detail.renders[0]).toMatchObject({ id: submitted.id, status: 'completed' });

      // A second render gets the next version and new files; nothing is overwritten.
      const again = await submit(project.id, 'render', { formats: ['long'] });
      expect(again).toMatchObject({
        type: 'long_form',
        renderVersion: submitted.renderVersion + 1,
      });
      await waitForRequest(again.id, (r) => r.status === 'completed');
    });

    it('previews at 720p on the preview queue, with music as a download URL', async () => {
      await startWorkers();
      const music = await editor
        .post('/api/media')
        .query(
          musicQuery({
            licenseType: 'creative_commons',
            license: 'CC BY 4.0',
            attributionRequired: 'true',
            attribution: 'Pad by Example (CC BY 4.0)',
          }),
        )
        .send(wav(6))
        .expect(201);
      const musicId = (music.body as { id: string }).id;
      const project = await createProject({
        outputMode: 'short',
        music: { assetId: musicId, volume: 0.5, fadeInSeconds: 1, fadeOutSeconds: 1, loop: true },
      });
      const submitted = await submit(project.id, 'preview');
      expect(submitted).toMatchObject({ type: 'preview', kind: 'preview', formats: ['short'] });
      const [job] = submitted.jobs;
      await waitForJob(job!.id, (j) => j.status === 'completed');
      const detail = jobDetailResponseSchema.parse((await editor.get(`/api/jobs/${job!.id}`)).body);
      expect(detail.manifest.raceConfig.resolution).toBe('720p');
      expect(detail.output).toMatchObject({
        width: 720,
        height: 1280,
        metadata: { gl: 'default' },
      });
      expect(detail.manifest.raceConfig.music).toEqual({
        volume: 0.5,
        fadeInSeconds: 1,
        fadeOutSeconds: 1,
        loop: true,
        durationSeconds: 6,
        attribution: 'Pad by Example (CC BY 4.0)',
        downloadUrl: `/api/media/${musicId}/file`,
      });
      // The license as it was when the render was submitted, and the checks that ran.
      expect(detail.manifest.musicLicense).toMatchObject({
        assetId: musicId,
        license: 'CC BY 4.0',
        commercialUse: true,
        attributionRequired: true,
      });
      expect(detail.manifest.quality?.checks.map((check) => check.id)).toContain('music_coverage');
      expect(detail.output?.metadata?.qualityChecks.map((check) => check.status)).toEqual([
        'pass',
        'pass',
        'pass',
      ]);
      expect(JSON.stringify(detail)).not.toMatch(/storage|assets\//);
      // Previews never change the project's status.
      expect((await editor.get(`/api/projects/${project.id}`)).body).toMatchObject({
        project: { status: 'draft' },
      });
    });

    it('refuses renders that fail the quality checks, before anything is queued', async () => {
      const upload = async (overrides: Record<string, string>) =>
        (
          (await editor.post('/api/media').query(musicQuery(overrides)).send(wav(6)).expect(201))
            .body as { id: string }
        ).id;
      const render = (projectId: string, kind: 'preview' | 'final') =>
        editor
          .post(`/api/projects/${projectId}/${kind === 'final' ? 'render' : 'preview'}`)
          .send({});

      // A 6 s track that does not loop cannot cover the video.
      const short = await createProject({
        outputMode: 'long',
        music: {
          assetId: await upload({}),
          volume: 0.5,
          fadeInSeconds: 1,
          fadeOutSeconds: 1,
          loop: false,
        },
      });
      const refused = await render(short.id, 'preview').expect(422);
      expect(errorCode(refused.body)).toBe('QUALITY_CHECK_FAILED');
      expect(JSON.stringify(refused.body)).toMatch(/music_coverage/);

      // Music that may not be used commercially: previews yes, published videos no.
      const personal = await createProject({
        outputMode: 'long',
        music: {
          assetId: await upload({ commercialUse: 'false' }),
          volume: 0.5,
          fadeInSeconds: 1,
          fadeOutSeconds: 1,
          loop: true,
        },
      });
      const final = await render(personal.id, 'final').expect(422);
      expect(JSON.stringify(final.body)).toMatch(/music_license/);
      await render(personal.id, 'preview').expect(202);

      const jobs = await editor.get('/api/jobs').query({ projectId: short.id });
      expect((jobs.body as { jobs: unknown[] }).jobs).toEqual([]);
    });

    it('deduplicates with Idempotency-Key and refuses a reused key for another request', async () => {
      const project = await createProject();
      const key = `key-${randomUUID()}`;
      const first = await editor
        .post(`/api/projects/${project.id}/render`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(202);
      const again = await editor
        .post(`/api/projects/${project.id}/render`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(200);
      expect(again.body).toMatchObject({
        replayed: true,
        request: { id: (first.body as { request: { id: string } }).request.id },
      });
      const reused = await editor
        .post(`/api/projects/${project.id}/render`)
        .set('Idempotency-Key', key)
        .send({ formats: ['long'] })
        .expect(409);
      expect(errorCode(reused.body)).toBe('IDEMPOTENCY_KEY_REUSED');
      await editor
        .post(`/api/projects/${project.id}/render`)
        .set('Idempotency-Key', 'bad key!')
        .send({})
        .expect(400);

      // Concurrent submissions with one key create one request.
      const raceKey = `race-${randomUUID()}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          editor
            .post(`/api/projects/${project.id}/preview`)
            .set('Idempotency-Key', raceKey)
            .send({}),
        ),
      );
      const ids = new Set(results.map((r) => (r.body as { request: { id: string } }).request.id));
      expect(ids.size).toBe(1);
    });

    it('does not queue an identical render twice while one is unfinished', async () => {
      const project = await createProject({ outputMode: 'long' });
      const first = await submit(project.id, 'render');
      const second = await editor.post(`/api/projects/${project.id}/render`).send({}).expect(200);
      expect(second.body).toMatchObject({ replayed: true, request: { id: first.id } });
    });

    it('rejects formats outside the output mode', async () => {
      const project = await createProject({ outputMode: 'long' });
      const response = await editor
        .post(`/api/projects/${project.id}/render`)
        .send({ formats: ['short'] })
        .expect(422);
      expect(errorCode(response.body)).toBe('FORMAT_NOT_IN_MODE');
    });

    it('recovers jobs submitted while no worker was running', async () => {
      const project = await createProject({ outputMode: 'long' });
      const submitted = await submit(project.id, 'preview');
      expect(submitted.jobs[0]).toMatchObject({ status: 'pending' });
      await startWorkers();
      await waitForRequest(submitted.id, (r) => r.status === 'completed');
    });

    it('cancels a queued job by removing it from the queue', async () => {
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      const cancelled = await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200);
      expect(cancelled.body).toMatchObject({
        job: { status: 'cancelled', errorCode: 'CANCELLED' },
      });
      expect(await h.services.queues.forKind('preview').getJob(jobs[0]!.id)).toBeUndefined();
      await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200); // twice is harmless
      await viewer.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(403);
    });

    it('cancels an active render through its worker and cleans up', async () => {
      await startWorkers('wait-for-cancel');
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'render');
      await waitForJob(jobs[0]!.id, (j) => j.status === 'rendering');
      expect(await tempDirectories()).toEqual([jobs[0]!.id]);
      await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200);
      const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'cancelled');
      expect(done).toMatchObject({ outputId: null, errorCode: 'CANCELLED' });
      expect(done.cancelRequestedAt).not.toBeNull();
      expect(await tempDirectories()).toEqual([]);
      expect((await editor.get(`/api/projects/${project.id}`)).body).toMatchObject({
        project: { status: 'draft' },
      });
    });

    it('cancels every output of a request', async () => {
      await startWorkers('wait-for-cancel');
      const project = await createProject();
      const submitted = await submit(project.id, 'render');
      await waitForRequest(submitted.id, (r) => r.jobs.every((j) => j.status === 'rendering'));
      await editor.post(`/api/renders/${submitted.id}/cancel`).expect(200);
      const done = await waitForRequest(submitted.id, (r) => r.status === 'cancelled');
      expect(done.jobs.map((j) => j.status)).toEqual(['cancelled', 'cancelled']);
    });

    it('retries recoverable failures and records each attempt', async () => {
      await startWorkers('fail-once');
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'completed');
      expect(done).toMatchObject({ attempts: 2, errorCode: null });
      const detail = jobDetailResponseSchema.parse(
        (await editor.get(`/api/jobs/${jobs[0]!.id}`)).body,
      );
      expect(detail.events.map((e) => e.message)).toEqual(
        expect.arrayContaining([
          'Attempt 1 of 2 failed (RENDER_FAILED): Chrome crashed; retrying',
          'Attempt 2 of 2 started',
        ]),
      );
    });

    it('fails an invalid output after its last attempt, never completing it', async () => {
      await startWorkers('corrupt-output');
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'failed');
      expect(done).toMatchObject({ attempts: 2, errorCode: 'OUTPUT_INVALID', outputId: null });
      expect(done.errorMessage).toMatch(/Invalid NAL unit size/);
      // Nothing half-finished is left behind.
      expect(await readdir(h.storage.resolve('renders/previews'))).not.toContainEqual(
        expect.stringContaining(project.id),
      );
      expect(await tempDirectories()).toEqual([]);
    });

    it('fails permanently without retrying when the composition does not match the plan', async () => {
      await startWorkers('wrong-frame-count');
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'render');
      const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'failed');
      expect(done).toMatchObject({ attempts: 1, errorCode: 'COMPOSITION_MISMATCH' });
      expect((await editor.get(`/api/projects/${project.id}`)).body).toMatchObject({
        project: { status: 'failed' },
      });
    });

    it('fails permanently when the immutable dataset file changed after submission', async () => {
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      const version = (
        await h.pool.query<{ processed_file_path: string }>(
          'SELECT processed_file_path FROM dataset_versions WHERE id = $1',
          [datasetVersionId],
        )
      ).rows[0]!.processed_file_path;
      const original = await h.storage.read(version);
      try {
        const tampered = JSON.parse(original.toString()) as { dataset: { title: string } };
        tampered.dataset.title = 'Tampered';
        await h.storage.writeAtomic(version, JSON.stringify(tampered));
        await startWorkers();
        const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'failed');
        expect(done).toMatchObject({ attempts: 1, errorCode: 'PROPS_MISMATCH' });
      } finally {
        await h.storage.writeAtomic(version, original);
      }
    });

    it('recovers a render from a crashed worker on another worker', async () => {
      const crashed = await startWorkers('hang', { lockDurationMs: 1_000, stalledIntervalMs: 500 });
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'render');
      await waitForJob(jobs[0]!.id, (j) => j.status === 'rendering');
      // Simulate a crash: the worker stops without returning the job or renewing its lock.
      await crashed.close({ force: true });
      workers = workers.filter((worker) => worker !== crashed);
      await startWorkers('succeed', { lockDurationMs: 1_000, stalledIntervalMs: 500 });
      const done = await waitForJob(jobs[0]!.id, (j) => j.status === 'completed');
      expect(done.attempts).toBe(1); // a crash does not use up an attempt
      const detail = jobDetailResponseSchema.parse(
        (await editor.get(`/api/jobs/${jobs[0]!.id}`)).body,
      );
      expect(detail.events.map((e) => e.message)).toContain(
        'The render worker stopped responding; the job will be retried',
      );
      expect(detail.events.filter((e) => e.message === 'Attempt 1 of 3 started')).toHaveLength(2);
      expect(await tempDirectories()).toEqual([]);
    }, 30_000);

    it('never runs a cancelled job again, even when it is put back on the queue', async () => {
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200);
      expect(await h.redis.exists(`${RENDER_CANCEL_KEY_PREFIX}${jobs[0]!.id}`)).toBe(1);

      // Simulate a retry scheduled anyway (e.g. by a worker that ignored the request).
      const record = await store.getJob(h.pool, jobs[0]!.id);
      await h.services.queues.enqueue(payloadFor(record!));
      await startWorkers();
      await vi.waitFor(async () => {
        const queued = await h.services.queues.forKind('preview').getJob(jobs[0]!.id);
        expect(await queued?.getState()).toBe('failed');
      });
      const after = jobDetailResponseSchema.parse(
        (await editor.get(`/api/jobs/${jobs[0]!.id}`)).body,
      ).job;
      expect(after).toMatchObject({ status: 'cancelled', outputId: null });
    });

    it('enforces the job lifecycle in PostgreSQL', async () => {
      // The trigger's rule is the same as canTransitionRenderJob.
      const { rows } = await h.pool.query<{ f: string; t: string; allowed: boolean }>(
        `SELECT f, t, render_job_transition_allowed(f, t) AS allowed
           FROM unnest($1::text[]) f CROSS JOIN unnest($1::text[]) t`,
        [RENDER_JOB_STATUSES],
      );
      expect(rows).toHaveLength(64);
      for (const row of rows) {
        expect([row.f, row.t, row.allowed]).toEqual([
          row.f,
          row.t,
          canTransitionRenderJob(row.f as RenderJob['status'], row.t as RenderJob['status']),
        ]);
      }
      // A finished job cannot change, and nothing completes without an output.
      const project = await createProject({ outputMode: 'long' });
      const { jobs } = await submit(project.id, 'preview');
      await editor.post(`/api/jobs/${jobs[0]!.id}/cancel`).expect(200);
      await expect(
        h.pool.query("UPDATE render_jobs SET status = 'completed' WHERE id = $1", [jobs[0]!.id]),
      ).rejects.toThrow(/already cancelled/);
      const other = await submit(project.id, 'render');
      await h.pool.query("UPDATE render_jobs SET status = 'validating' WHERE id = $1", [
        other.jobs[0]!.id,
      ]);
      await expect(
        h.pool.query("UPDATE render_jobs SET status = 'completed' WHERE id = $1", [
          other.jobs[0]!.id,
        ]),
      ).rejects.toThrow(/invalid render job transition validating -> completed/);
    });

    it('streams progress over Server-Sent Events, resumes with Last-Event-ID and ends on completion', async () => {
      const server = h.app.listen(0);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const project = await createProject({ outputMode: 'long' });
        const { jobs } = await submit(project.id, 'preview');
        const stream = await readSse(
          `${base}/api/jobs/${jobs[0]!.id}/events`,
          h.tokens.editor,
          async () => {
            await startWorkers();
          },
        );
        expect(stream[0]).toMatchObject({ event: 'state' });
        const logs = stream.filter((e) => e.event === 'log');
        expect(logs.length).toBeGreaterThanOrEqual(6);
        const ids = logs.map((e) => Number(e.id));
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        const states = stream
          .filter((e) => e.event === 'state')
          .map((e) => (JSON.parse(e.data) as RenderJob).status);
        expect(states.at(-1)).toBe('completed');
        const end = stream.at(-1)!;
        expect(end.event).toBe('end');
        expect(JSON.parse(end.data)).toMatchObject({
          job: { status: 'completed' },
          output: { format: 'long' },
        });

        // Reconnecting after the job finished: only missed log entries, then `end` straight away.
        const lastSeen = logs[1]!.id!;
        const resumed = await readSse(
          `${base}/api/jobs/${jobs[0]!.id}/events`,
          h.tokens.editor,
          undefined,
          lastSeen,
        );
        const resumedLogs = resumed.filter((e) => e.event === 'log');
        expect(resumedLogs.every((e) => Number(e.id) > Number(lastSeen))).toBe(true);
        expect(resumedLogs).toHaveLength(logs.length - 2);
        expect(resumed.at(-1)?.event).toBe('end');

        const unauthenticated = await fetch(`${base}/api/jobs/${jobs[0]!.id}/events`);
        expect(unauthenticated.status).toBe(401);
      } finally {
        server.close();
      }
    });

    it('streams aggregate progress of a "both" request', async () => {
      const server = h.app.listen(0);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const project = await createProject();
        const submitted = await submit(project.id, 'render');
        const stream = await readSse(
          `${base}/api/renders/${submitted.id}/events`,
          h.tokens.viewer,
          async () => {
            await startWorkers();
          },
        );
        const states = stream
          .filter((e) => e.event === 'state')
          .map((e) => JSON.parse(e.data) as RenderRequest);
        const percents = states.map((s) => s.percent);
        expect(percents).toEqual([...percents].sort((a, b) => a - b)); // never goes backwards
        expect(states.at(-1)).toMatchObject({ status: 'completed', percent: 100 });
        // Log entries of both outputs arrive on the one stream.
        const jobIds = new Set(
          stream
            .filter((e) => e.event === 'log')
            .map((e) => (JSON.parse(e.data) as { renderJobId: string }).renderJobId),
        );
        expect(jobIds).toEqual(new Set(submitted.jobs.map((j) => j.id)));
        const end = JSON.parse(stream.at(-1)!.data) as { outputs: unknown[] };
        expect(end.outputs).toHaveLength(2);
      } finally {
        server.close();
      }
    });
  });
});

interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/** Reads an SSE stream to its end. `onOpen` runs once the stream is established. */
async function readSse(
  url: string,
  token: string,
  onOpen?: () => Promise<void>,
  lastEventId?: string,
): Promise<SseEvent[]> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`Not an event stream: HTTP ${response.status} ${await response.text()}`);
  }
  await onOpen?.();
  const text = await response.text();
  return text
    .split('\n\n')
    .map((block) => {
      const fields = Object.fromEntries(
        block
          .split('\n')
          .filter((line) => line && !line.startsWith(':'))
          .map((line) => [
            line.slice(0, line.indexOf(':')),
            line.slice(line.indexOf(':') + 1).trim(),
          ]),
      );
      return fields as unknown as SseEvent;
    })
    .filter((event) => event.event);
}
