import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { JobChange } from '@statsopedia/render-store';
import type { RenderJobPayload, RenderProgress } from '@statsopedia/shared-types';
import {
  ConfigError,
  LocalStorage,
  createLogger,
  ensureStorageDirectories,
} from '@statsopedia/utils/node';
import { UnrecoverableError, WaitingError } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { startAssetServer } from '../src/asset-server.js';
import { orphanedBrowsers, parseProcessList } from '../src/browsers.js';
import { loadConfig } from '../src/config.js';
import { classifyError, JobSupersededError, permanentError, RenderError } from '../src/errors.js';
import {
  createJobLog,
  prepareTempDirectory,
  publishFile,
  sweepTempDirectories,
} from '../src/files.js';
import { parseLoudnorm, parseProbe, topLevelBoxes, type ProbeResult } from '../src/media-tools.js';
import { outputProblems, type PipelineDependencies } from '../src/pipeline.js';
import {
  CANCELLED_MESSAGE,
  USER_CANCEL_REASON,
  createRenderProcessor,
  type ProcessableJob,
} from '../src/processor.js';
import { collectStorageReferences, resolveStorageReferences } from '../src/props.js';
import { glFor } from '../src/renderer.js';

// The processor writes outcomes through the render store; record them instead of a database.
const transitions: { jobId: string; change: JobChange }[] = [];
let storedJob: { cancelRequestedAt: string | null; status: string } | null = null;
vi.mock('@statsopedia/render-store', () => ({
  transitionJob: vi.fn((_pool: unknown, jobId: string, change: JobChange) => {
    transitions.push({ jobId, change });
    return Promise.resolve({
      applied: true,
      job: { projectId: PROJECT_ID, kind: 'final', outputFormat: 'long', renderVersion: 1 },
      event: null,
    });
  }),
  getJob: vi.fn(() => Promise.resolve(storedJob)),
}));

const logger = createLogger({ service: 'render-worker-test', level: 'silent' });
const JOB_ID = '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d';
const PROJECT_ID = '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c';
const payload: RenderJobPayload = {
  renderJobId: JOB_ID,
  requestId: '1c8e7d3f-69a5-4d5c-8b9f-6e2a3b4c5d6e',
  projectId: PROJECT_ID,
  kind: 'final',
  outputFormat: 'long',
};

let root: string;
let storage: LocalStorage;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'statsopedia-worker-'));
  await ensureStorageDirectories(root);
  storage = new LocalStorage(root);
  transitions.length = 0;
  storedJob = null;
});
afterEach(() => rm(root, { recursive: true, force: true }));

function fakeJob(overrides: Partial<ProcessableJob> = {}) {
  const progress: RenderProgress[] = [];
  const job: ProcessableJob & { progress: RenderProgress[]; movedToWait: number } = {
    id: JOB_ID,
    data: payload,
    attemptsMade: 0,
    opts: { attempts: 3 },
    progress,
    movedToWait: 0,
    updateProgress: (value) => {
      progress.push(value);
      return Promise.resolve();
    },
    moveToWait() {
      job.movedToWait += 1;
      return Promise.resolve(0);
    },
    ...overrides,
  };
  return job;
}

function processor(
  run: NonNullable<Parameters<typeof createRenderProcessor>[0]['run']>,
  cancelled = false,
) {
  return createRenderProcessor({
    pool: {} as PipelineDependencies['pool'],
    storage: new LocalStorage(os.tmpdir()),
    renderer: {} as PipelineDependencies['renderer'],
    media: {} as PipelineDependencies['media'],
    logger,
    workerId: 'test',
    assetBaseUrl: 'http://127.0.0.1:1',
    concurrency: null,
    isCancelled: () => Promise.resolve(cancelled),
    timeoutMs: { preview: 60_000, final: 60_000 },
    run,
  });
}

const statuses = () => transitions.map((t) => t.change.status);

/** A render that runs until its signal aborts. */
const untilAborted = (_deps: unknown, _payload: unknown, attempt: { signal: AbortSignal }) =>
  new Promise<never>((_, reject) => {
    if (attempt.signal.aborted) reject(new Error('aborted'));
    attempt.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('render processor', () => {
  it('fails malformed payloads permanently without rendering', async () => {
    const run = vi.fn();
    await expect(processor(run)(fakeJob({ data: { renderJobId: 'nope' } }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('passes attempt numbers and reports progress to the queue', async () => {
    const job = fakeJob({ attemptsMade: 1 });
    const result = await processor((_deps, received, attempt) => {
      expect(received).toEqual(payload);
      expect([attempt.number, attempt.maxAttempts]).toEqual([2, 3]);
      attempt.reportToQueue({ status: 'rendering', percent: 40, message: null });
      return Promise.resolve({
        renderJobId: JOB_ID,
        outputId: JOB_ID,
        fileSizeBytes: 1,
        checksumSha256: 'a'.repeat(64),
        durationMs: 5,
      });
    })(job);
    expect(result.outputId).toBe(JOB_ID);
    expect(job.progress).toEqual([{ status: 'rendering', percent: 40, message: null }]);
  });

  it('retries retryable errors while attempts remain, recording the attempt', async () => {
    await expect(
      processor(() => Promise.reject(new Error('Target closed')))(fakeJob()),
    ).rejects.toMatchObject({ code: 'RENDER_FAILED', retryable: true });
    expect(transitions[0]!.change).toMatchObject({
      status: 'pending',
      errorCode: 'RENDER_FAILED',
      log: {
        level: 'warn',
        message: expect.stringMatching(/^Attempt 1 of 3 failed .*retrying$/) as unknown,
      },
    });
  });

  it('fails permanently on the last attempt and on permanent errors, keeping the message', async () => {
    await expect(
      processor(() => Promise.reject(new Error('Target closed')))(fakeJob({ attemptsMade: 2 })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      processor(() => Promise.reject(permanentError('DATASET_MISSING', 'File is gone')))(fakeJob()),
    ).rejects.toThrow('DATASET_MISSING: File is gone');
    expect(statuses()).toEqual(['failed', 'failed']);
    expect(transitions[1]!.change).toMatchObject({
      errorCode: 'DATASET_MISSING',
      errorMessage: 'File is gone',
    });
  });

  it('records a user cancellation as cancelled and never retries it', async () => {
    const controller = new AbortController();
    const pending = processor(untilAborted)(fakeJob(), 'token', controller.signal);
    controller.abort(USER_CANCEL_REASON);
    await expect(pending).rejects.toThrow(CANCELLED_MESSAGE);
    expect(statuses()).toEqual(['cancelled']);
  });

  it('returns a render interrupted by shutdown to the queue without using an attempt', async () => {
    const controller = new AbortController();
    const job = fakeJob();
    const pending = processor(untilAborted)(job, 'token', controller.signal);
    controller.abort('worker-shutdown');
    await expect(pending).rejects.toBeInstanceOf(WaitingError);
    expect(job.movedToWait).toBe(1);
    expect(statuses()).toEqual(['pending']);
  });

  it('times out a hung render as a retryable RENDER_TIMEOUT', async () => {
    const run = createRenderProcessor({
      ...({} as PipelineDependencies),
      logger,
      isCancelled: () => Promise.resolve(false),
      timeoutMs: { preview: 20, final: 20 },
      run: untilAborted,
    });
    await expect(run(fakeJob())).rejects.toMatchObject({ code: 'RENDER_TIMEOUT' });
    expect(transitions[0]!.change).toMatchObject({
      status: 'pending',
      errorCode: 'RENDER_TIMEOUT',
    });
  });

  it('never starts an attempt for a job a user cancelled', async () => {
    const run = vi.fn();
    await expect(processor(run, true)(fakeJob())).rejects.toThrow(CANCELLED_MESSAGE);
    expect(run).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['cancelled']);
  });

  it('stops quietly when the job was finished elsewhere, recording a pending cancellation', async () => {
    storedJob = { cancelRequestedAt: new Date().toISOString(), status: 'validating' };
    await expect(
      processor(() => Promise.reject(new JobSupersededError('Cancellation was requested')))(
        fakeJob(),
      ),
    ).rejects.toThrow(CANCELLED_MESSAGE);
    expect(statuses()).toEqual(['cancelled']);
  });
});

describe('classifyError', () => {
  it('separates permanent from retryable failures', () => {
    expect(classifyError(new z.ZodError([]))).toMatchObject({
      code: 'INVALID_PROPS',
      retryable: false,
    });
    expect(classifyError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toMatchObject({
      code: 'STORAGE_FAILED',
      retryable: false,
    });
    expect(classifyError(Object.assign(new Error('full'), { code: 'ENOSPC' }))).toMatchObject({
      code: 'STORAGE_FAILED',
      retryable: true,
    });
    expect(classifyError(Object.assign(new Error('gone'), { code: '57P01' }))).toMatchObject({
      code: 'DATABASE_FAILED',
      retryable: true,
    });
    expect(classifyError(new Error('A delayRender() call timed out'))).toMatchObject({
      code: 'RENDER_TIMEOUT',
      retryable: true,
    });
    expect(classifyError(new Error('Browser crashed'))).toMatchObject({
      code: 'RENDER_FAILED',
      retryable: true,
    });
    const known = new RenderError('OUTPUT_EXISTS', 'x', false);
    expect(classifyError(known)).toBe(known);
  });
});

describe('files', () => {
  it('publishes atomically and never replaces an existing file', async () => {
    const temp = await prepareTempDirectory(storage, JOB_ID);
    await writeFile(temp.file('a.mp4'), 'first');
    await publishFile(storage, temp.file('a.mp4'), 'renders/long/x.mp4');
    expect(await readFile(storage.resolve('renders/long/x.mp4'), 'utf8')).toBe('first');
    expect(await readdir(temp.directory)).toEqual([]); // moved, not copied

    await writeFile(temp.file('b.mp4'), 'second');
    await expect(
      publishFile(storage, temp.file('b.mp4'), 'renders/long/x.mp4'),
    ).rejects.toMatchObject({
      code: 'OUTPUT_EXISTS',
      retryable: false,
    });
    expect(await readFile(storage.resolve('renders/long/x.mp4'), 'utf8')).toBe('first');
  });

  it('isolates each job in a fresh temp directory and sweeps stale ones', async () => {
    const first = await prepareTempDirectory(storage, JOB_ID);
    await writeFile(first.file('leftover.mp4'), 'crashed attempt');
    const second = await prepareTempDirectory(storage, JOB_ID);
    expect(await readdir(second.directory)).toEqual([]); // the crashed attempt's file is gone

    const other = await prepareTempDirectory(storage, PROJECT_ID);
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(other.directory, old, old);
    expect(await sweepTempDirectories(storage, 3_600_000)).toBe(1);
    expect(await readdir(storage.resolve('temp/renders'))).toEqual([JOB_ID]);
  });

  it('appends NDJSON entries to the job log', async () => {
    const log = createJobLog(storage, 'logs/x_long_v1.log');
    await log({ level: 'info', message: 'one' });
    await log({ level: 'warn', message: 'two' });
    const lines = (await readFile(storage.resolve('logs/x_long_v1.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      'one',
      'two',
    ]);
  });
});

describe('media checks', () => {
  const mp4 = (...boxes: [string, number][]) =>
    Buffer.concat(
      boxes.map(([type, size]) => {
        const box = Buffer.alloc(size);
        box.writeUInt32BE(size, 0);
        box.write(type, 4, 'latin1');
        return box;
      }),
    );

  it('reads top-level MP4 boxes to detect faststart files', async () => {
    const file = path.join(root, 'a.mp4');
    await writeFile(file, mp4(['ftyp', 24], ['moov', 100], ['mdat', 400]));
    expect(await topLevelBoxes(file)).toEqual(['ftyp', 'moov', 'mdat']);
    await writeFile(file, mp4(['ftyp', 24], ['mdat', 400], ['moov', 100]));
    expect(await topLevelBoxes(file)).toEqual(['ftyp', 'mdat', 'moov']);
  });

  it('parses ffprobe JSON and loudnorm output', () => {
    const probe = parseProbe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '24.000000', size: '3344587' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
          nb_frames: '720',
          pix_fmt: 'yuv420p',
        },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      ],
    });
    expect(probe.video).toEqual({
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 30,
      frames: 720,
      pixelFormat: 'yuv420p',
    });
    expect(probe.audio).toEqual({ codec: 'aac', sampleRate: 48_000, channels: 2 });
    expect(
      parseLoudnorm('[Parsed_loudnorm_0]\n{\n "input_i" : "-26.73",\n "input_tp" : "-16.47"\n}'),
    ).toEqual({ integratedLufs: -26.73, truePeakDbtp: -16.47 });
    expect(parseLoudnorm('{ "input_i" : "-inf", "input_tp" : "-inf" }')).toEqual({
      integratedLufs: null,
      truePeakDbtp: null,
    });
  });

  it('lists every way a rendered file differs from the plan', () => {
    const plan = { width: 1920, height: 1080, fps: 30, durationInFrames: 720 };
    const good: ProbeResult = {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 24,
      sizeBytes: 1,
      video: {
        codec: 'h264',
        width: 1920,
        height: 1080,
        fps: 30,
        frames: 720,
        pixelFormat: 'yuv420p',
      },
      audio: { codec: 'aac', sampleRate: 48_000, channels: 2 },
    };
    expect(outputProblems(good, plan, { expectAudio: true })).toEqual([]);
    expect(
      outputProblems(
        { ...good, video: { ...good.video!, height: 720, frames: 600 }, audio: null },
        plan,
        { expectAudio: true },
      ),
    ).toEqual([
      'size is 1920×720, expected 1920×1080',
      '600 frames, expected 720',
      'music was configured but there is no audio',
    ]);
    expect(outputProblems({ ...good, video: null }, plan, { expectAudio: false })).toEqual([
      'no video stream',
    ]);
  });
});

describe('storage references', () => {
  it('collects and resolves storage:assets strings, deeply, and nothing else', () => {
    const props = {
      config: { music: { src: 'storage:assets/music/a.wav' } },
      entities: [{ logo: 'storage:assets/logos/b.png' }, { logo: 'https://example.com/c.png' }],
      note: 'storage:processed/secret.json',
    };
    expect(collectStorageReferences(props)).toEqual(['assets/music/a.wav', 'assets/logos/b.png']);
    expect(resolveStorageReferences(props, 'http://127.0.0.1:9')).toEqual({
      config: { music: { src: 'http://127.0.0.1:9/assets/music/a.wav' } },
      entities: [
        { logo: 'http://127.0.0.1:9/assets/logos/b.png' },
        { logo: 'https://example.com/c.png' },
      ],
      note: 'storage:processed/secret.json',
    });
  });

  it('uses deterministic software GL for final renders only', () => {
    expect(glFor('final')).toBe('swangle');
    expect(glFor('preview')).toBeNull();
  });
});

describe('orphaned browsers', () => {
  it('finds only Remotion browsers whose worker is gone', () => {
    const shell = '/tmp/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell --headless';
    const processes = parseProcessList(
      [
        `  101     1   101 ${shell}`, // orphaned: worker killed
        `  102   101   101 ${shell} --type=renderer`, // its helper (dies with the group)
        `  201   200   201 ${shell}`, // a live worker's browser
        '  301     1   301 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '  401     1   401 /usr/sbin/sshd',
      ].join('\n'),
    );
    expect(processes).toHaveLength(5);
    expect(orphanedBrowsers(processes).map((p) => p.pid)).toEqual([101]);
  });
});

describe('asset server', () => {
  beforeEach(async () => {
    await writeFile(path.join(root, 'assets/music/a.wav'), '0123456789');
    await writeFile(path.join(root, 'processed/secret.json'), '{}');
  });

  it('serves assets with ranges and nothing outside assets/', async () => {
    const server = await startAssetServer(storage, logger);
    try {
      const full = await fetch(`${server.baseUrl}/assets/music/a.wav`);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('audio/wav');
      expect(await full.text()).toBe('0123456789');

      const partial = await fetch(`${server.baseUrl}/assets/music/a.wav`, {
        headers: { range: 'bytes=2-4' },
      });
      expect(partial.status).toBe(206);
      expect(await partial.text()).toBe('234');

      expect((await fetch(`${server.baseUrl}/processed/secret.json`)).status).toBe(404);
      expect((await fetch(`${server.baseUrl}/assets/../processed/secret.json`)).status).toBe(404);
      expect((await fetch(`${server.baseUrl}/assets/%2e%2e/processed/secret.json`)).status).toBe(
        404,
      );
      expect((await fetch(`${server.baseUrl}/assets/music/a.wav`, { method: 'POST' })).status).toBe(
        405,
      );
    } finally {
      await server.close();
    }
  });
});

describe('loadConfig', () => {
  const env = {
    REDIS_URL: 'redis://127.0.0.1:6379',
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  };

  it('requires Redis and PostgreSQL and starts with one production render at a time', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ REDIS_URL: env.REDIS_URL })).toThrow(ConfigError);
    const config = loadConfig(env);
    expect(path.isAbsolute(config.RENDERER_ENTRY_POINT)).toBe(true);
    expect(config.RENDER_CONCURRENCY).toBe(1);
    expect(config.PREVIEW_CONCURRENCY).toBe(1);
    expect(config.REMOTION_CONCURRENCY).toBeUndefined();
    expect(config.RENDER_TIMEOUT_MINUTES).toBe(60);
    expect(config.FFMPEG_BINARIES_DIR).toBeUndefined();
  });

  it('accepts tuning through environment variables', () => {
    const config = loadConfig({
      ...env,
      RENDER_CONCURRENCY: '2',
      REMOTION_CONCURRENCY: '4',
      RENDER_TIMEOUT_MINUTES: '30',
      FFMPEG_BINARIES_DIR: '/opt/ffmpeg',
    });
    expect([config.RENDER_CONCURRENCY, config.REMOTION_CONCURRENCY]).toEqual([2, 4]);
    expect(config.RENDER_TIMEOUT_MINUTES).toBe(30);
    expect(config.FFMPEG_BINARIES_DIR).toBe('/opt/ffmpeg');
  });
});
