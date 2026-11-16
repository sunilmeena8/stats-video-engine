import type {
  DashboardStats,
  JobListResponse,
  OutputListItem,
  OutputListResponse,
  CreateDatasetRequest,
  CreateProjectRequest,
  JobDetailResponse,
  ProjectDetailResponse,
  ProjectListResponse,
  SubmitRenderRequest,
  RenderSubmissionResponse,
  UpdateProjectRequest,
  DatasetDetailResponse,
  DatasetListResponse,
  DatasetPreviewResponse,
  DatasetVersionsResponse,
  ImportResponse,
  RenderRequestDetailResponse,
  ReprocessRequest,
  ValidateResponse,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import {
  datasetPeriodSchema,
  datasetSchema,
  datasetTitleSchema,
  datasetUnitSchema,
  datasetVersionSchema,
  interpolationOptionsSchema,
  metricConfigurationSchema,
  processingOptionsSchema,
} from './dataset.js';
import { isoDateTimeSchema, slugSchema, uuidSchema } from './primitives.js';
import { rankedValueSchema, validationIssueSchema, validationReportSchema } from './processing.js';
import {
  renderJobEventSchema,
  renderJobSchema,
  renderManifestSchema,
  renderRequestSchema,
  videoOutputSchema,
} from './render.js';
import {
  outputFormatSchema,
  projectNameSchema,
  videoConfigurationSchema,
  videoProjectSchema,
} from './video.js';

export const createDatasetRequestSchema = z
  .object({
    title: datasetTitleSchema,
    slug: slugSchema.optional(),
    description: z.string().trim().max(5_000).nullish(),
    topicId: z.uuid().nullish(),
    unit: datasetUnitSchema.nullish(),
    metric: metricConfigurationSchema.partial().strict().optional(),
    processing: processingOptionsSchema
      .extend({ interpolation: interpolationOptionsSchema.partial().strict() })
      .partial()
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<CreateDatasetRequest>;

export const reprocessRequestSchema = z
  .object({
    metric: metricConfigurationSchema.optional(),
    processing: processingOptionsSchema.optional(),
  })
  .strict() satisfies z.ZodType<ReprocessRequest>;

export const datasetListItemSchema = datasetSchema.extend({
  versionCount: z.int().nonnegative(),
  latestVersion: datasetVersionSchema.nullable(),
});

export const datasetListResponseSchema = z.object({
  datasets: z.array(datasetListItemSchema),
}) satisfies z.ZodType<DatasetListResponse>;

export const datasetDetailResponseSchema = z.object({
  dataset: datasetSchema,
  latestVersion: datasetVersionSchema.nullable(),
  lastUpload: datasetVersionSchema.nullable(),
  versionCount: z.int().nonnegative(),
}) satisfies z.ZodType<DatasetDetailResponse>;

export const datasetVersionsResponseSchema = z.object({
  versions: z.array(datasetVersionSchema),
}) satisfies z.ZodType<DatasetVersionsResponse>;

export const importResponseSchema = z.object({
  version: datasetVersionSchema,
  report: validationReportSchema,
}) satisfies z.ZodType<ImportResponse>;

export const validateResponseSchema = z.object({
  report: validationReportSchema,
}) satisfies z.ZodType<ValidateResponse>;

function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    total: z.int().nonnegative(),
    offset: z.int().nonnegative(),
    limit: z.int().nonnegative(),
    items: z.array(item),
  });
}

export const previewObservationSchema = z.object({
  row: z.int().min(2),
  entityId: z.string(),
  entityName: z.string(),
  period: datasetPeriodSchema,
  value: z.number().nullable(),
  sourceId: z.string(),
  notes: z.string().nullable(),
});

export const previewRankingEntrySchema = rankedValueSchema.extend({
  name: z.string(),
  category: z.string().nullable(),
});

export const datasetPreviewResponseSchema = z.object({
  dataset: datasetSchema,
  version: datasetVersionSchema,
  unit: z.string().nullable(),
  periods: z.array(datasetPeriodSchema),
  period: datasetPeriodSchema.nullable(),
  top: z.int().min(1),
  ranking: z.array(previewRankingEntrySchema),
  issues: pageSchema(validationIssueSchema),
  observations: pageSchema(previewObservationSchema),
}) satisfies z.ZodType<DatasetPreviewResponse>;

/** Query string of `GET /api/datasets/:id/preview`. */
export const datasetPreviewQuerySchema = z
  .object({
    versionId: z.uuid().optional(),
    period: datasetPeriodSchema.optional(),
    top: z.coerce.number().int().min(1).max(50).default(10),
    issuesOffset: z.coerce.number().int().min(0).default(0),
    issuesLimit: z.coerce.number().int().min(1).max(500).default(50),
    rowsOffset: z.coerce.number().int().min(0).default(0),
    rowsLimit: z.coerce.number().int().min(1).max(500).default(50),
    /** Only records whose entity id or name contains this text (case-insensitive). */
    entity: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

// ─── Projects and rendering ──────────────────────────────────────────────────────────────────

export const createProjectRequestSchema = z
  .object({
    name: projectNameSchema,
    topicId: uuidSchema.nullish(),
    configuration: videoConfigurationSchema
      .partial()
      .required({ datasetVersionId: true, templateId: true }),
  })
  .strict() satisfies z.ZodType<CreateProjectRequest>;

export const updateProjectRequestSchema = z
  .object({
    revision: z.int().min(1),
    name: projectNameSchema,
    topicId: uuidSchema.nullable(),
    configuration: videoConfigurationSchema,
  })
  .strict() satisfies z.ZodType<UpdateProjectRequest>;

export const submitRenderRequestSchema = z
  .object({
    formats: z
      .array(outputFormatSchema)
      .min(1)
      .refine((formats) => new Set(formats).size === formats.length, 'Formats must be unique')
      .optional(),
  })
  .strict() satisfies z.ZodType<SubmitRenderRequest>;

/** `Idempotency-Key` header: client-chosen, 8–128 safe characters (e.g. a UUID). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,128}$/, 'Must be 8–128 characters of A-Z, a-z, 0-9, _ . : -');

export const projectDetailResponseSchema = z.object({
  project: videoProjectSchema,
  renders: z.array(renderRequestSchema),
  jobs: z.array(renderJobSchema),
  outputs: z.array(videoOutputSchema),
}) satisfies z.ZodType<ProjectDetailResponse>;

export const projectListResponseSchema = z.object({
  projects: z.array(videoProjectSchema),
}) satisfies z.ZodType<ProjectListResponse>;

export const renderSubmissionResponseSchema = z.object({
  request: renderRequestSchema,
  replayed: z.boolean(),
}) satisfies z.ZodType<RenderSubmissionResponse>;

export const renderRequestDetailResponseSchema = z.object({
  request: renderRequestSchema,
  outputs: z.array(videoOutputSchema),
}) satisfies z.ZodType<RenderRequestDetailResponse>;

export const jobDetailResponseSchema = z.object({
  job: renderJobSchema,
  manifest: renderManifestSchema,
  output: videoOutputSchema.nullable(),
  events: z.array(renderJobEventSchema),
}) satisfies z.ZodType<JobDetailResponse>;

const nonNegativeInt = z.int().nonnegative();

export const dashboardStatsSchema = z.object({
  datasets: nonNegativeInt,
  projects: nonNegativeInt,
  renders: z.object({
    completed: nonNegativeInt,
    pending: nonNegativeInt,
    failed: nonNegativeInt,
    cancelled: nonNegativeInt,
  }),
  outputs: nonNegativeInt,
  storage: z.object({
    areas: z.array(z.object({ area: z.string(), bytes: nonNegativeInt, files: nonNegativeInt })),
    usedBytes: nonNegativeInt,
    volumeBytes: nonNegativeInt.nullable(),
    freeBytes: nonNegativeInt.nullable(),
    measuredAt: isoDateTimeSchema,
  }),
}) satisfies z.ZodType<DashboardStats>;

export const outputListItemSchema = videoOutputSchema.extend({
  title: z.string(),
  projectName: z.string(),
  datasetId: uuidSchema,
  datasetTitle: z.string(),
  datasetVersionId: uuidSchema,
  datasetVersion: z.int().positive(),
}) satisfies z.ZodType<OutputListItem>;

export const outputListResponseSchema = z.object({
  outputs: z.array(outputListItemSchema),
}) satisfies z.ZodType<OutputListResponse>;

export const jobListResponseSchema = z.object({
  jobs: z.array(renderJobSchema),
}) satisfies z.ZodType<JobListResponse>;
