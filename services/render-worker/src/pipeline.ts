import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import {
  completeJob,
  loadRenderContext,
  outputExistsForKey,
  transitionJob,
  type JobChange,
  type LogEntry,
  type RenderContext,
  type TransactionPool,
} from '@statsopedia/render-store';
import { barChartRacePropsSchema } from '@statsopedia/shared-schemas';
import type {
  QualityCheck,
  RenderJobPayload,
  RenderJobResult,
  RenderJobStatus,
  RenderMetadata,
  RenderProgress,
} from '@statsopedia/shared-types';
import { canonicalJson } from '@statsopedia/utils';
import { sha256File, storageKeys, type LocalStorage, type Logger } from '@statsopedia/utils/node';
import { planRaceRender, type RaceRenderPlan } from '@statsopedia/video-config';
import type pg from 'pg';

import { EDGE_SECONDS, audioQualityChecks } from './audio-checks.js';
import { JobSupersededError, permanentError, retryableError } from './errors.js';
import { createJobLog, prepareTempDirectory, publishFile } from './files.js';
import type { MediaTools, ProbeResult } from './media-tools.js';
import { collectStorageReferences, resolveStorageReferences } from './props.js';
import {
  REMOTION_VERSION,
  glFor,
  type SelectedComposition,
  type VideoRenderer,
} from './renderer.js';

export interface PipelineDependencies {
  pool: TransactionPool & Pick<pg.Pool, 'query'>;
  storage: LocalStorage;
  renderer: VideoRenderer;
  media: MediaTools;
  logger: Logger;
  workerId: string;
  /** Base URL of the local asset server that serves `storage/assets/` to Chrome. */
  assetBaseUrl: string;
  /** Remotion frame concurrency (recorded in the metadata). */
  concurrency: number | null;
}

export interface Attempt {
  /** 1-based. */
  number: number;
  maxAttempts: number;
  /** Aborted on cancellation, worker shutdown or timeout. */
  signal: AbortSignal;
  /** Reports progress to BullMQ. */
  reportToQueue: (progress: RenderProgress) => void;
}

/** Percent ranges of the job's progress bar. */
const RANGE = { validating: 0, preparing: 2, rendering: 5, renderingEnd: 85, post: 86 } as const;
/** Write progress to PostgreSQL every 2 percent; add a log entry every 10 percent. */
const DB_STEP = 2;
const LOG_STEP = 10;

/**
 * Records a job's progress in PostgreSQL (and its render log file) and BullMQ. Stage changes
 * are awaited and refused once the job has been cancelled or finished elsewhere; progress
 * within a stage is throttled and written in order without blocking rendering.
 */
class ProgressRecorder {
  #chain: Promise<unknown> = Promise.resolve();
  #status: RenderJobStatus = 'pending';
  #dbPercent = -Infinity;
  #logPercent = -Infinity;
  #queuePercent = -Infinity;
  superseded = false;
  log: ((entry: Record<string, unknown>) => Promise<void>) | undefined;

  constructor(
    private readonly pool: TransactionPool,
    private readonly jobId: string,
    private readonly attempt: Attempt,
    private readonly logger: Logger,
  ) {}

  /** Moves the job to a new stage. Throws JobSupersededError if the job was finished meanwhile. */
  async stage(
    status: RenderJobStatus,
    percent: number,
    message: string,
    extra: Partial<JobChange> = {},
  ) {
    await this.#chain;
    const result = await transitionJob(this.pool, this.jobId, {
      ...extra,
      status,
      percent,
      message,
      log: { level: 'info', message },
    });
    if (!result?.applied) {
      this.superseded = true;
      throw new JobSupersededError(
        `Job is ${result?.job.status ?? 'missing'}; this attempt stops without changing it`,
      );
    }
    this.#status = status;
    this.#dbPercent = this.#logPercent = this.#queuePercent = percent;
    this.attempt.reportToQueue({ status, percent, message });
    await this.writeLog({ level: 'info', status, percent, message });
  }

  /** Progress within the current stage (throttled; never throws). */
  progress(percent: number, message: string) {
    const status = this.#status;
    if (percent >= this.#queuePercent + 1) {
      this.#queuePercent = percent;
      this.attempt.reportToQueue({ status, percent, message });
    }
    if (percent < this.#dbPercent + DB_STEP || this.superseded) return;
    this.#dbPercent = percent;
    const log: LogEntry | null =
      percent >= this.#logPercent + LOG_STEP ? { level: 'info', message } : null;
    if (log) this.#logPercent = percent;
    this.#chain = this.#chain
      .then(async () => {
        const result = await transitionJob(this.pool, this.jobId, {
          status,
          percent,
          message,
          log,
        });
        if (!result?.applied) this.superseded = true;
        else if (log) await this.writeLog({ level: 'info', status, percent, message });
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error, renderJobId: this.jobId }, 'Could not record progress'),
      );
  }

  async flush() {
    await this.#chain;
  }

  async writeLog(entry: Record<string, unknown>) {
    try {
      await this.log?.({ attempt: this.attempt.number, ...entry });
    } catch (error) {
      this.logger.warn({ err: error, renderJobId: this.jobId }, 'Could not write the render log');
    }
  }
}

function checkPayload(payload: RenderJobPayload, context: RenderContext) {
  const { job } = context;
  const mismatch =
    job.requestId !== payload.requestId ||
    job.projectId !== payload.projectId ||
    job.kind !== payload.kind ||
    job.outputFormat !== payload.outputFormat;
  if (mismatch) {
    throw permanentError('INVALID_PAYLOAD', 'Queue payload does not match the job in PostgreSQL');
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** Every problem with a rendered file, compared with what the render plan promised. */
export function outputProblems(
  probe: ProbeResult,
  plan: Pick<RaceRenderPlan, 'width' | 'height' | 'fps' | 'durationInFrames'>,
  { expectAudio }: { expectAudio: boolean },
): string[] {
  const problems: string[] = [];
  const video = probe.video;
  if (!probe.formatName.includes('mp4')) problems.push(`container is ${probe.formatName}, not MP4`);
  if (!video) return [...problems, 'no video stream'];
  if (video.codec !== 'h264') problems.push(`video codec is ${video.codec}, not h264`);
  if (video.pixelFormat !== 'yuv420p') problems.push(`pixel format is ${video.pixelFormat}`);
  if (video.width !== plan.width || video.height !== plan.height) {
    problems.push(`size is ${video.width}×${video.height}, expected ${plan.width}×${plan.height}`);
  }
  if (Math.abs(video.fps - plan.fps) > 0.01)
    problems.push(`${video.fps} fps, expected ${plan.fps}`);
  const frames = video.frames ?? Math.round(probe.durationSeconds * plan.fps);
  if (Math.abs(frames - plan.durationInFrames) > 1) {
    problems.push(`${frames} frames, expected ${plan.durationInFrames}`);
  }
  if (expectAudio && !probe.audio) problems.push('music was configured but there is no audio');
  return problems;
}

/**
 * Renders one job:
 *
 *  validate the job, its immutable dataset version, its pinned manifest and every asset →
 *  rebuild the exact props and check them against the manifest checksum → select the
 *  composition and check size and frame count → render → post-process (faststart, loudness)
 *  → validate the file (ffprobe and a full decode) → publish without overwriting → store the
 *  output, metadata and `completed` in one transaction.
 *
 * Failures are thrown (see errors.ts); the processor records them. Temporary files are always
 * removed; published files are removed unless the output was stored.
 */
export async function runRenderJob(
  deps: PipelineDependencies,
  payload: RenderJobPayload,
  attempt: Attempt,
): Promise<RenderJobResult> {
  const { pool, storage, renderer, media, logger, workerId, signal } = { ...deps, ...attempt };
  const started = performance.now();
  const cpu = process.cpuUsage();
  const marks: Record<string, number> = {};
  const mark = (name: string) => (marks[name] = performance.now());
  const progress = new ProgressRecorder(pool, payload.renderJobId, attempt, logger);

  // ── 1–2. Received and validated by the processor. Start the attempt.
  mark('validating');
  await progress.stage(
    'validating',
    RANGE.validating,
    `Attempt ${attempt.number} of ${attempt.maxAttempts} started`,
    { attempts: attempt.number, workerId },
  );

  // ── 3–5. Load the job, the immutable dataset version and the project configuration; verify
  // every required asset exists.
  const context = await loadRenderContext(pool, payload.renderJobId);
  if (!context) throw permanentError('JOB_NOT_FOUND', 'Render job, request or manifest not found');
  checkPayload(payload, context);
  const { job, manifest, datasetVersion, music } = context;
  const name = {
    projectId: job.projectId,
    kind: job.kind,
    format: job.outputFormat,
    renderVersion: job.renderVersion,
  };
  progress.log = createJobLog(storage, storageKeys.renderLog(name));
  await progress.writeLog({
    level: 'info',
    status: 'validating',
    message: 'Attempt started',
    workerId,
  });
  if (job.cancelRequestedAt) throw new JobSupersededError('Cancellation was requested');

  if (!datasetVersion) throw permanentError('DATASET_MISSING', 'Dataset version not found');
  if (datasetVersion.status !== 'ready' || !datasetVersion.normalizedKey) {
    throw permanentError(
      'DATASET_NOT_READY',
      `Dataset version ${datasetVersion.version} is ${datasetVersion.status}`,
    );
  }
  const normalizedPath = storage.resolve(datasetVersion.normalizedKey);
  if ((await fileSize(normalizedPath)) === null) {
    throw permanentError(
      'DATASET_MISSING',
      `Dataset version ${datasetVersion.version} file is missing`,
    );
  }
  if (manifest.musicAssetId) {
    if (!music || music.type !== 'music') {
      throw permanentError('ASSET_MISSING', 'The music asset no longer exists');
    }
    const size = await fileSize(storage.resolve(music.storageKey));
    if (
      size !== music.sizeBytes ||
      (await storage.sha256(music.storageKey)) !== music.checksumSha256
    ) {
      throw permanentError('ASSET_MISSING', 'The music file is missing or has changed');
    }
  }
  if (await outputExistsForKey(pool, job.outputKey)) {
    throw permanentError('OUTPUT_EXISTS', 'A finished video already uses this file name');
  }

  // ── 6. Animation-ready props: exactly what was validated when the job was submitted.
  mark('preparing');
  await progress.stage('preparing', RANGE.preparing, 'Preparing input props and renderer');
  const parsed = barChartRacePropsSchema.safeParse({
    dataset: await storage.readJson(datasetVersion.normalizedKey),
    config: manifest.raceConfig,
  });
  if (!parsed.success) throw permanentError('INVALID_PROPS', parsed.error.message);
  const props = parsed.data;
  const checksum = createHash('sha256').update(canonicalJson(props)).digest('hex');
  if (checksum !== manifest.propsChecksum) {
    throw permanentError(
      'PROPS_MISMATCH',
      'Input props differ from those validated at submission (the dataset file changed)',
    );
  }
  for (const key of collectStorageReferences(props)) {
    if ((await fileSize(storage.resolve(key))) === null) {
      throw permanentError('ASSET_MISSING', `A referenced asset is missing (${key.split('/')[1]})`);
    }
  }
  const inputProps = resolveStorageReferences(props, deps.assetBaseUrl) as Record<string, unknown>;

  // ── 7–8. Select the composition and check its size, frame rate and frame count.
  const plan = planRaceRender(props);
  const gl = glFor(job.kind);
  const composition: SelectedComposition = await renderer.selectComposition({
    compositionId: manifest.compositionId,
    inputProps,
    gl,
    signal,
  });
  for (const key of ['width', 'height', 'fps', 'durationInFrames'] as const) {
    if (composition[key] !== plan[key]) {
      throw permanentError(
        'COMPOSITION_MISMATCH',
        `Composition ${composition.id} has ${key} ${composition[key]}, expected ${plan[key]}`,
      );
    }
  }
  const seconds = (plan.durationInFrames / plan.fps).toFixed(1);
  const temp = await prepareTempDirectory(storage, job.id);
  const published: string[] = [];
  let stored = false;

  try {
    // ── 9. Render.
    mark('rendering');
    await progress.stage(
      'rendering',
      RANGE.rendering,
      `Rendering ${composition.id}: ${plan.width}×${plan.height}, ${plan.durationInFrames} frames (${seconds} s)`,
    );
    const rendered = temp.file('render.mp4');
    const span = RANGE.renderingEnd - RANGE.rendering;
    await renderer.renderVideo({
      composition,
      inputProps,
      output: rendered,
      kind: job.kind,
      gl,
      signal,
      onProgress: ({ renderedFrames, progress: share }) =>
        progress.progress(
          Math.floor(RANGE.rendering + share * span),
          renderedFrames >= plan.durationInFrames
            ? 'Encoding video'
            : `Rendered ${renderedFrames} of ${plan.durationInFrames} frames`,
        ),
    });
    signal.throwIfAborted();
    await progress.flush();
    if (progress.superseded) throw new JobSupersededError('Job finished while rendering');

    // ── 10. Post-process: index at the start of the file (web playback), loudness.
    mark('postProcessing');
    await progress.stage('post_processing', RANGE.post, 'Post-processing video');
    let video = rendered;
    const faststart = await media.isFaststart(rendered);
    if (!faststart) {
      video = temp.file('video.mp4');
      await media.remuxFaststart(rendered, video, signal);
      progress.progress(88, 'Moved the MP4 index to the start of the file');
    }

    // ── 11. Validate the file: the expected streams, size and frames, and a full decode.
    const probe = await media.probe(video, signal);
    const problems = outputProblems(probe, plan, { expectAudio: props.config.music !== null });
    if (problems.length) {
      throw retryableError('OUTPUT_INVALID', `Rendered file is invalid: ${problems.join('; ')}`);
    }
    progress.progress(90, 'Checking that every frame decodes');
    try {
      await media.verifyDecodes(video, signal);
    } catch (error) {
      signal.throwIfAborted();
      throw retryableError(
        'OUTPUT_INVALID',
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    const loudness = probe.audio ? await media.measureLoudness(video, signal) : null;
    let qualityChecks: QualityCheck[] = [];
    if (props.config.music && probe.audio) {
      progress.progress(92, 'Checking the music: level, peaks and fades');
      qualityChecks = audioQualityChecks(props.config.music, {
        integratedLufs: loudness?.integratedLufs ?? null,
        truePeakDbtp: loudness?.truePeakDbtp ?? null,
        startPeakDbtp: await media.measureEdgePeak(video, 'start', EDGE_SECONDS, signal),
        endPeakDbtp: await media.measureEdgePeak(video, 'end', EDGE_SECONDS, signal),
      });
      const failed = qualityChecks.filter((check) => check.status === 'fail');
      if (failed.length) {
        // The same inputs always give the same audio: retrying cannot help.
        throw permanentError(
          'OUTPUT_INVALID',
          `Audio check failed: ${failed.map((check) => check.detail).join(' ')}`,
        );
      }
      for (const check of qualityChecks.filter((item) => item.status === 'warn')) {
        await progress.writeLog({ level: 'warn', message: `${check.title}: ${check.detail}` });
      }
    }
    progress.progress(94, 'Creating thumbnail');

    let thumbnailKey: string | null = null;
    if (manifest.thumbnailFrame !== null) {
      const thumbnail = temp.file('thumbnail.jpg');
      try {
        await renderer.renderThumbnail({
          composition,
          inputProps,
          frame: Math.min(manifest.thumbnailFrame, plan.durationInFrames - 1),
          output: thumbnail,
          gl,
          signal,
        });
        thumbnailKey = storageKeys.thumbnail(name);
      } catch (error) {
        signal.throwIfAborted();
        // A missing thumbnail never fails a finished render.
        logger.warn({ err: error, renderJobId: job.id }, 'Thumbnail failed');
        await progress.writeLog({ level: 'warn', message: 'Thumbnail failed' });
      }
      if (thumbnailKey) {
        await publishFile(storage, thumbnail, thumbnailKey);
        published.push(thumbnailKey);
      }
    }

    // ── 12. Metadata.
    progress.progress(97, 'Recording checksum and metadata');
    const checksumSha256 = await sha256File(video);
    const sizeBytes = (await stat(video)).size;
    const finished = performance.now();
    const usage = process.cpuUsage(cpu);
    const elapsed = (from: string, to: number | undefined) =>
      Math.round((to ?? finished) - (marks[from] ?? finished));
    const metadata: RenderMetadata = {
      attempt: attempt.number,
      workerId,
      remotionVersion: REMOTION_VERSION,
      gl: gl ?? 'default',
      concurrency: deps.concurrency,
      compositionId: composition.id,
      durationInFrames: plan.durationInFrames,
      datasetVersionId: manifest.datasetVersionId,
      templateVersion: manifest.templateVersion,
      propsChecksum: manifest.propsChecksum,
      pixelFormat: probe.video!.pixelFormat,
      faststart: true,
      qualityChecks,
      audio: probe.audio
        ? {
            codec: probe.audio.codec,
            sampleRate: probe.audio.sampleRate,
            channels: probe.audio.channels,
            integratedLufs: loudness?.integratedLufs ?? null,
            truePeakDbtp: loudness?.truePeakDbtp ?? null,
          }
        : null,
      timingsMs: {
        validating: elapsed('validating', marks.preparing),
        preparing: elapsed('preparing', marks.rendering),
        rendering: elapsed('rendering', marks.postProcessing),
        postProcessing: elapsed('postProcessing', undefined),
        total: Math.round(finished - started),
      },
      resources: {
        cpuUserMs: Math.round(usage.user / 1000),
        cpuSystemMs: Math.round(usage.system / 1000),
        // maxRSS is in kilobytes.
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
      },
    };

    // ── 13. Store: publish the file (never replacing one), then output + completed atomically.
    signal.throwIfAborted();
    await progress.flush();
    await publishFile(storage, video, job.outputKey);
    published.push(job.outputKey);
    const outputId = randomUUID();
    const message = `Render completed: ${plan.width}×${plan.height}, ${seconds} s, ${(sizeBytes / 1e6).toFixed(1)} MB`;
    const result = await completeJob(pool, job.id, {
      attempts: attempt.number,
      log: { level: 'info', message },
      output: {
        id: outputId,
        renderJobId: job.id,
        projectId: job.projectId,
        kind: job.kind,
        format: job.outputFormat,
        renderVersion: job.renderVersion,
        storageKey: job.outputKey,
        thumbnailKey,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        durationSeconds: Math.round((plan.durationInFrames / plan.fps) * 1000) / 1000,
        fileSizeBytes: sizeBytes,
        checksumSha256,
        codec: 'h264',
        metadata,
      },
    });
    if (!result?.applied) throw new JobSupersededError('Job finished before the output was stored');
    stored = true;

    // ── 14. Subscribers are notified by PostgreSQL (NOTIFY) and BullMQ progress.
    attempt.reportToQueue({ status: 'completed', percent: 100, message });
    await progress.writeLog({
      level: 'info',
      status: 'completed',
      percent: 100,
      message,
      metadata,
    });
    logger.info(
      {
        renderJobId: job.id,
        outputId,
        sizeBytes,
        timingsMs: metadata.timingsMs,
        resources: metadata.resources,
      },
      'Render completed',
    );
    return {
      renderJobId: job.id,
      outputId,
      fileSizeBytes: sizeBytes,
      checksumSha256,
      durationMs: metadata.timingsMs.total,
    };
  } finally {
    await temp.remove().catch(() => undefined);
    if (!stored) {
      // Incomplete output: nothing references these files, so remove them.
      for (const key of published) await storage.remove(key).catch(() => undefined);
    }
    await progress.flush();
  }
}

/** Writes a failure or retry to PostgreSQL and the job's render log. */
export async function recordFailure(
  deps: Pick<PipelineDependencies, 'pool' | 'storage' | 'logger'>,
  payload: RenderJobPayload,
  change: JobChange,
): Promise<void> {
  try {
    const result = await transitionJob(deps.pool, payload.renderJobId, change);
    if (result?.applied && change.log) {
      await createJobLog(
        deps.storage,
        storageKeys.renderLog({
          projectId: result.job.projectId,
          kind: result.job.kind,
          format: result.job.outputFormat,
          renderVersion: result.job.renderVersion,
        }),
      )({
        level: change.log.level,
        status: change.status,
        errorCode: change.errorCode,
        message: change.log.message,
      }).catch(() => undefined);
    }
  } catch (error) {
    // PostgreSQL unavailable: the API's monitor reconciles the job from BullMQ later.
    deps.logger.error(
      { err: error, renderJobId: payload.renderJobId },
      'Could not record the failure',
    );
  }
}
