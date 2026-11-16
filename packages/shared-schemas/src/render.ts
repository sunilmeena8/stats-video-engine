import {
  RENDER_ERROR_CODES,
  RENDER_JOB_STATUSES,
  RENDER_KINDS,
  RENDER_REQUEST_STATUSES,
  RENDER_REQUEST_TYPES,
  VIDEO_CODECS,
  type RenderJob,
  type RenderJobEvent,
  type RenderJobPayload,
  type RenderJobResult,
  type RenderManifest,
  type RenderMetadata,
  type RenderProgress,
  type RenderRequest,
  type VideoOutput,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { isoDateTimeSchema, sha256Schema, timestampsShape, uuidSchema } from './primitives.js';
import { musicLicenseSnapshotSchema } from './media.js';
import { qualityCheckSchema, qualityReportSchema } from './quality.js';
import { publicRaceConfigSchema } from './race.js';
import { compositionIdSchema, outputFormatSchema } from './video.js';

const positiveInt = z.int().positive();
const percentSchema = z.number().min(0).max(100);

export const renderJobStatusSchema = z.enum(RENDER_JOB_STATUSES);
export const renderErrorCodeSchema = z.enum(RENDER_ERROR_CODES);

export const renderProgressSchema = z.object({
  status: renderJobStatusSchema,
  percent: percentSchema,
  message: z.string().max(500).nullable(),
}) satisfies z.ZodType<RenderProgress>;

export const renderJobSchema = z.object({
  id: uuidSchema,
  requestId: uuidSchema,
  projectId: uuidSchema,
  manifestId: uuidSchema,
  kind: z.enum(RENDER_KINDS),
  outputFormat: outputFormatSchema,
  renderVersion: positiveInt,
  status: renderJobStatusSchema,
  percent: percentSchema,
  message: z.string().nullable(),
  attempts: z.int().nonnegative(),
  maxAttempts: positiveInt,
  errorCode: renderErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  cancelRequestedAt: isoDateTimeSchema.nullable(),
  createdBy: uuidSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  outputId: uuidSchema.nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<RenderJob>;

export const renderRequestSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  type: z.enum(RENDER_REQUEST_TYPES),
  kind: z.enum(RENDER_KINDS),
  formats: z.array(outputFormatSchema).min(1).max(2),
  renderVersion: positiveInt,
  status: z.enum(RENDER_REQUEST_STATUSES),
  percent: percentSchema,
  idempotencyKey: z.string().nullable(),
  createdBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  jobs: z.array(renderJobSchema),
}) satisfies z.ZodType<RenderRequest>;

export const renderJobEventSchema = z.object({
  id: positiveInt,
  renderJobId: uuidSchema,
  at: isoDateTimeSchema,
  level: z.enum(['info', 'warn', 'error']),
  status: renderJobStatusSchema,
  percent: percentSchema,
  message: z.string(),
}) satisfies z.ZodType<RenderJobEvent>;

export const renderManifestSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  kind: z.enum(RENDER_KINDS),
  outputFormat: outputFormatSchema,
  compositionId: compositionIdSchema,
  templateId: uuidSchema,
  templateVersion: positiveInt,
  datasetVersionId: uuidSchema,
  musicAssetId: uuidSchema.nullable(),
  musicLicense: musicLicenseSnapshotSchema.nullable(),
  quality: qualityReportSchema.nullable(),
  raceConfig: publicRaceConfigSchema,
  propsChecksum: sha256Schema,
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<RenderManifest>;

const nonNegativeMs = z.number().nonnegative();

export const renderMetadataSchema = z.object({
  attempt: positiveInt,
  workerId: z.string().min(1).max(200),
  remotionVersion: z.string().min(1),
  gl: z.string().min(1),
  concurrency: positiveInt.nullable(),
  compositionId: compositionIdSchema,
  durationInFrames: positiveInt,
  datasetVersionId: uuidSchema,
  templateVersion: positiveInt,
  propsChecksum: sha256Schema,
  pixelFormat: z.string().min(1),
  faststart: z.boolean(),
  audio: z
    .object({
      codec: z.string().min(1),
      sampleRate: positiveInt,
      channels: positiveInt,
      integratedLufs: z.number().nullable(),
      truePeakDbtp: z.number().nullable(),
    })
    .nullable(),
  qualityChecks: z.array(qualityCheckSchema),
  timingsMs: z.object({
    validating: nonNegativeMs,
    preparing: nonNegativeMs,
    rendering: nonNegativeMs,
    postProcessing: nonNegativeMs,
    total: nonNegativeMs,
  }),
  resources: z.object({
    cpuUserMs: nonNegativeMs,
    cpuSystemMs: nonNegativeMs,
    peakRssBytes: z.int().nonnegative(),
  }),
}) satisfies z.ZodType<RenderMetadata>;

export const videoOutputSchema = z.object({
  id: uuidSchema,
  renderJobId: uuidSchema,
  projectId: uuidSchema,
  kind: z.enum(RENDER_KINDS),
  format: outputFormatSchema,
  renderVersion: positiveInt,
  width: positiveInt,
  height: positiveInt,
  fps: z.number().positive(),
  durationSeconds: z.number().positive(),
  fileSizeBytes: z.int().nonnegative(),
  codec: z.enum(VIDEO_CODECS),
  checksumSha256: sha256Schema,
  metadata: renderMetadataSchema.nullable(),
  downloadUrl: z.string().startsWith('/api/'),
  thumbnailUrl: z.string().startsWith('/api/').nullable(),
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<VideoOutput>;

/** Validated by producers before enqueueing and by workers before rendering. */
export const renderJobPayloadSchema = z
  .object({
    renderJobId: uuidSchema,
    requestId: uuidSchema,
    projectId: uuidSchema,
    kind: z.enum(RENDER_KINDS),
    outputFormat: outputFormatSchema,
  })
  .strict() satisfies z.ZodType<RenderJobPayload>;

export const renderJobResultSchema = z.object({
  renderJobId: uuidSchema,
  outputId: uuidSchema,
  fileSizeBytes: z.int().nonnegative(),
  checksumSha256: sha256Schema,
  durationMs: nonNegativeMs,
}) satisfies z.ZodType<RenderJobResult>;
