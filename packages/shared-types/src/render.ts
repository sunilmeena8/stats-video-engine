import type { IsoDateTime, Timestamps, Uuid } from './common.js';
import type { MusicLicenseSnapshot } from './media.js';
import type { QualityCheck, QualityReport } from './quality.js';
import type { PublicRaceConfig } from './race.js';
import type { OutputFormat } from './video.js';

/** BullMQ queue names. Producers and workers must agree on these exactly. */
export const QUEUE_NAMES = {
  /** Fast, low-resolution checks; never block final renders. */
  renderPreview: 'statsopedia-render-preview',
  /** Upload-quality renders. */
  renderFinal: 'statsopedia-render-final',
} as const;

/**
 * BullMQ failedReason of a job a user cancelled. The worker fails a cancelled job with exactly
 * this message; the API records it as `cancelled` rather than `failed`.
 */
export const RENDER_CANCELLED_MESSAGE = 'Render cancelled by user';

/**
 * Redis key set (for a day) when a user cancels a job. Workers check it before every attempt,
 * so a cancelled job can never start again, even if a retry was already scheduled.
 */
export const RENDER_CANCEL_KEY_PREFIX = 'statsopedia:render-cancelled:';

/** Redis pub/sub channels. */
export const REDIS_CHANNELS = {
  /** Message: a render job id. Workers abort that job if they are running it. */
  renderCancel: 'statsopedia:render-cancel',
} as const;

/**
 * Lifecycle of one render job (one output file):
 *
 *   pending → validating → preparing → rendering → post_processing → completed
 *
 * Any unfinished job may fail, be cancelled, go back to `pending` (waiting for a retry) or
 * restart at `validating` (a new attempt, e.g. after a worker crash). Finished jobs never change.
 */
export const RENDER_JOB_STATUSES = [
  'pending',
  'validating',
  'preparing',
  'rendering',
  'post_processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const TERMINAL_RENDER_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type TerminalRenderJobStatus = (typeof TERMINAL_RENDER_JOB_STATUSES)[number];

/** Unfinished statuses, in pipeline order. */
export const ACTIVE_RENDER_JOB_STATUSES = [
  'pending',
  'validating',
  'preparing',
  'rendering',
  'post_processing',
] as const;

const FORWARD: Partial<Record<RenderJobStatus, RenderJobStatus>> = {
  validating: 'preparing',
  preparing: 'rendering',
  rendering: 'post_processing',
  post_processing: 'completed',
};

export function isTerminalRenderStatus(status: RenderJobStatus): status is TerminalRenderJobStatus {
  return (TERMINAL_RENDER_JOB_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a job may move from `from` to `to`. PostgreSQL enforces the same rule with a trigger
 * (migration 003), so a failed or cancelled job can never be marked completed.
 */
export function canTransitionRenderJob(from: RenderJobStatus, to: RenderJobStatus): boolean {
  if (isTerminalRenderStatus(from)) return false;
  if (from === to) return true; // progress within a stage
  if (to === 'failed' || to === 'cancelled' || to === 'pending' || to === 'validating') return true;
  return FORWARD[from] === to;
}

/** `preview` renders are fast low-stakes checks; `final` renders are upload candidates. */
export const RENDER_KINDS = ['preview', 'final'] as const;
export type RenderKind = (typeof RENDER_KINDS)[number];

/** What a user asked for. `both` renders long-form and Shorts as two independently tracked jobs. */
export const RENDER_REQUEST_TYPES = ['preview', 'long_form', 'short', 'both'] as const;
export type RenderRequestType = (typeof RENDER_REQUEST_TYPES)[number];

/**
 * Overall state of a request: `partial` when some outputs completed and others failed or were
 * cancelled.
 */
export const RENDER_REQUEST_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type RenderRequestStatus = (typeof RENDER_REQUEST_STATUSES)[number];

/**
 * Why a job failed. Retryable errors (a crashed browser, a timeout, a database hiccup) are
 * retried up to the job's attempt limit; the others fail at once because a retry cannot help.
 */
export const RENDER_ERROR_CODES = [
  'INVALID_PAYLOAD',
  'JOB_NOT_FOUND',
  'DATASET_NOT_READY',
  'DATASET_MISSING',
  'ASSET_MISSING',
  'INVALID_PROPS',
  'PROPS_MISMATCH',
  'COMPOSITION_MISMATCH',
  'OUTPUT_EXISTS',
  'OUTPUT_INVALID',
  'RENDER_TIMEOUT',
  'RENDER_FAILED',
  'FFMPEG_FAILED',
  'STORAGE_FAILED',
  'DATABASE_FAILED',
  'WORKER_CRASHED',
  'QUEUE_LOST',
  'QUEUE_UNAVAILABLE',
  'CANCELLED',
] as const;
export type RenderErrorCode = (typeof RENDER_ERROR_CODES)[number];

export const VIDEO_CODECS = ['h264'] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

/** What a worker reports while rendering (BullMQ job progress). */
export interface RenderProgress {
  status: RenderJobStatus;
  /** 0–100. */
  percent: number;
  message: string | null;
}

/** One render of a project in one output format. The PostgreSQL row is the record of truth. */
export interface RenderJob extends Timestamps {
  id: Uuid;
  requestId: Uuid;
  projectId: Uuid;
  manifestId: Uuid;
  kind: RenderKind;
  outputFormat: OutputFormat;
  /** Per-project render number; part of the output file name. */
  renderVersion: number;
  status: RenderJobStatus;
  /** 0–100. */
  percent: number;
  message: string | null;
  attempts: number;
  maxAttempts: number;
  errorCode: RenderErrorCode | null;
  errorMessage: string | null;
  cancelRequestedAt: IsoDateTime | null;
  createdBy: Uuid | null;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  outputId: Uuid | null;
}

/** One submission: a preview, a long-form video, a Short, or both from one project. */
export interface RenderRequest {
  id: Uuid;
  projectId: Uuid;
  type: RenderRequestType;
  kind: RenderKind;
  formats: OutputFormat[];
  renderVersion: number;
  status: RenderRequestStatus;
  /** Average progress of its jobs (finished jobs count as 100). */
  percent: number;
  idempotencyKey: string | null;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  jobs: RenderJob[];
}

/** One entry of a job's render log. Ids increase, so they double as SSE event ids. */
export interface RenderJobEvent {
  id: number;
  renderJobId: Uuid;
  at: IsoDateTime;
  level: 'info' | 'warn' | 'error';
  status: RenderJobStatus;
  percent: number;
  message: string;
}

/**
 * Exactly what was rendered: the resolved renderer config plus the template and dataset
 * version it came from. Immutable; every render job points at one.
 */
export interface RenderManifest {
  id: Uuid;
  projectId: Uuid;
  kind: RenderKind;
  outputFormat: OutputFormat;
  compositionId: string;
  templateId: Uuid;
  templateVersion: number;
  datasetVersionId: Uuid;
  musicAssetId: Uuid | null;
  /** The music's licensing as it was when the render was submitted. */
  musicLicense: MusicLicenseSnapshot | null;
  /** Quality checks run before the render was queued (null for older renders). */
  quality: QualityReport | null;
  /** The renderer configuration, with music exposed as a download URL. */
  raceConfig: PublicRaceConfig;
  /** SHA-256 of the full input props, so identical renders are recognisable. */
  propsChecksum: string;
  createdAt: IsoDateTime;
}

/** How a video was made: timings, resources and media checks, recorded by the worker. */
export interface RenderMetadata {
  attempt: number;
  workerId: string;
  remotionVersion: string;
  /** Chrome GL backend; `swangle` (software) makes final renders reproducible. */
  gl: string;
  concurrency: number | null;
  compositionId: string;
  durationInFrames: number;
  datasetVersionId: Uuid;
  templateVersion: number;
  propsChecksum: string;
  pixelFormat: string;
  /** The MP4 index is at the start of the file, so playback starts before the download ends. */
  faststart: boolean;
  audio: {
    codec: string;
    sampleRate: number;
    channels: number;
    /** EBU R128 integrated loudness. */
    integratedLufs: number | null;
    truePeakDbtp: number | null;
  } | null;
  /** Checks of the encoded audio: present, audible, not clipped, faded in and out. */
  qualityChecks: QualityCheck[];
  timingsMs: {
    validating: number;
    preparing: number;
    rendering: number;
    postProcessing: number;
    total: number;
  };
  resources: {
    cpuUserMs: number;
    cpuSystemMs: number;
    /** Peak resident memory of the worker process (Chrome runs in separate processes). */
    peakRssBytes: number;
  };
}

/** A finished video. Files are served through `downloadUrl`; storage paths are never exposed. */
export interface VideoOutput {
  id: Uuid;
  renderJobId: Uuid;
  projectId: Uuid;
  kind: RenderKind;
  format: OutputFormat;
  renderVersion: number;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  fileSizeBytes: number;
  codec: VideoCodec;
  checksumSha256: string;
  /** Null for videos rendered before render metadata was recorded. */
  metadata: RenderMetadata | null;
  downloadUrl: string;
  thumbnailUrl: string | null;
  createdAt: IsoDateTime;
}

/**
 * Data placed on a render queue. Only identifiers: the worker loads the job, its manifest and
 * the immutable dataset version from PostgreSQL and checks them against these values.
 */
export interface RenderJobPayload {
  renderJobId: Uuid;
  requestId: Uuid;
  projectId: Uuid;
  kind: RenderKind;
  outputFormat: OutputFormat;
}

/** Value a render-worker returns to BullMQ for a completed job. */
export interface RenderJobResult {
  renderJobId: Uuid;
  outputId: Uuid;
  fileSizeBytes: number;
  checksumSha256: string;
  durationMs: number;
}
