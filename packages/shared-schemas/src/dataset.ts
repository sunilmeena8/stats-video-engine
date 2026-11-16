import {
  DATA_FREQUENCIES,
  DATASET_ENTITY_TYPES,
  DATASET_VERSION_STATUSES,
  INTERPOLATION_METHODS,
  MISSING_VALUE_POLICIES,
  RANKING_ORDERS,
  VALIDATION_STATUSES,
  type DataPoint,
  type DataSource,
  type Dataset,
  type DatasetEntity,
  type DatasetVersion,
  type InterpolationOptions,
  type MetricConfiguration,
  type PeriodRange,
  type ProcessingOptions,
  type ProcessingSummary,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import {
  YEAR_MAX,
  YEAR_MIN,
  hexColorSchema,
  httpUrlSchema,
  isoDateTimeSchema,
  sha256Schema,
  slugSchema,
  timestampsShape,
  uuidSchema,
  yearRangeSchema,
} from './primitives.js';

export const TOP_N_LIMIT = 100;
export const STEPS_PER_PERIOD_MAX = 60;
export const MAX_GAP_PERIODS_LIMIT = 10_000;

/**
 * A dataset period: yearly `YYYY` (optionally negative for BCE), monthly `YYYY-MM` or daily
 * `YYYY-MM-DD`. Calendar validity is checked by the data-processor, which parses the CSV.
 */
export const datasetPeriodSchema = z
  .string()
  .regex(/^(-?\d{1,5}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/, 'Must be YYYY, YYYY-MM or YYYY-MM-DD');

export const periodRangeSchema = z.object({
  start: datasetPeriodSchema,
  end: datasetPeriodSchema,
}) satisfies z.ZodType<PeriodRange>;

/** A key copied from the CSV (`entity_id`, `source_id`): kept exactly, so no normalization. */
export const csvKeySchema = z
  .string()
  .min(1)
  .max(120)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'Must not contain control characters')
  .refine((value) => value.trim() === value, 'Must not start or end with whitespace');

export const metricConfigurationSchema = z.object({
  frequency: z.enum(DATA_FREQUENCIES),
  rankingOrder: z.enum(RANKING_ORDERS),
  allowNegative: z.boolean(),
}) satisfies z.ZodType<MetricConfiguration>;

export const interpolationOptionsSchema = z.object({
  method: z.enum(INTERPOLATION_METHODS),
  stepsPerPeriod: z.int().min(1).max(STEPS_PER_PERIOD_MAX),
  maxGapPeriods: z.int().min(0).max(MAX_GAP_PERIODS_LIMIT),
  allowLargeGaps: z.boolean(),
}) satisfies z.ZodType<InterpolationOptions>;

export const processingOptionsSchema = z.object({
  topN: z.int().min(1).max(TOP_N_LIMIT).nullable(),
  missingValues: z.enum(MISSING_VALUE_POLICIES),
  interpolation: interpolationOptionsSchema,
}) satisfies z.ZodType<ProcessingOptions>;

export const DEFAULT_METRIC_CONFIGURATION: Readonly<MetricConfiguration> = {
  frequency: 'yearly',
  rankingOrder: 'desc',
  allowNegative: false,
};

export const DEFAULT_PROCESSING_OPTIONS: Readonly<ProcessingOptions> = {
  topN: null,
  missingValues: 'exclude',
  interpolation: { method: 'linear', stepsPerPeriod: 1, maxGapPeriods: 1, allowLargeGaps: false },
};

export const dataSourceSchema = z.object({
  id: uuidSchema,
  key: csvKeySchema,
  name: z.string().trim().min(1).max(200),
  publisher: z.string().trim().min(1).max(200).nullable(),
  url: httpUrlSchema.nullable(),
  license: z.string().trim().max(200).nullable(),
  accessedAt: isoDateTimeSchema.nullable(),
  notes: z.string().max(5_000).nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<DataSource>;

export const datasetTitleSchema = z.string().trim().min(1).max(200);
export const datasetUnitSchema = z.string().trim().min(1).max(80);

export const datasetSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  title: datasetTitleSchema,
  description: z.string().max(5_000).nullable(),
  topicId: uuidSchema.nullable(),
  unit: datasetUnitSchema.nullable(),
  metric: metricConfigurationSchema,
  processing: processingOptionsSchema,
  dataSourceIds: z.array(uuidSchema),
  latestVersionId: uuidSchema.nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<Dataset>;

const countSchema = z.int().nonnegative();

export const processingSummarySchema = z.object({
  rowCount: countSchema,
  validRowCount: countSchema,
  entityCount: countSchema,
  sourceCount: countSchema,
  periodCount: countSchema,
  observedPeriodCount: countSchema,
  missingValueCount: countSchema,
  errorCount: countSchema,
  warningCount: countSchema,
  issueCounts: z.record(z.string(), countSchema),
  durationMs: z.number().nonnegative(),
}) satisfies z.ZodType<ProcessingSummary>;

export const datasetVersionSchema = z.object({
  id: uuidSchema,
  datasetId: uuidSchema,
  version: z.int().min(1),
  status: z.enum(DATASET_VERSION_STATUSES),
  validationStatus: z.enum(VALIDATION_STATUSES),
  sourceVersionId: uuidSchema.nullable(),
  originalFilename: z.string().trim().min(1).max(255),
  sizeBytes: countSchema,
  hasNormalizedOutput: z.boolean(),
  checksumSha256: sha256Schema,
  metric: metricConfigurationSchema,
  processing: processingOptionsSchema,
  rowCount: countSchema.nullable(),
  entityCount: countSchema.nullable(),
  periodRange: periodRangeSchema.nullable(),
  yearRange: yearRangeSchema.nullable(),
  errorCount: countSchema.nullable(),
  warningCount: countSchema.nullable(),
  summary: processingSummarySchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
}) satisfies z.ZodType<DatasetVersion>;

export const datasetEntitySchema = z.object({
  id: uuidSchema,
  datasetVersionId: uuidSchema,
  key: csvKeySchema,
  name: z.string().trim().min(1).max(200),
  type: z.enum(DATASET_ENTITY_TYPES),
  category: z.string().max(120).nullable(),
  imageUrl: httpUrlSchema.nullable(),
  isoCode: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Must be an ISO 3166-1 alpha-3 code')
    .nullable(),
  color: hexColorSchema.nullable(),
  logoAssetId: uuidSchema.nullable(),
}) satisfies z.ZodType<DatasetEntity>;

export const dataPointSchema = z.object({
  datasetVersionId: uuidSchema,
  entityId: uuidSchema,
  period: datasetPeriodSchema,
  year: z.int().min(YEAR_MIN).max(YEAR_MAX),
  // Zod 4's z.number() rejects NaN and ±Infinity.
  value: z.number().nullable(),
  dataSourceId: uuidSchema,
  sourceRow: z.int().min(2),
  notes: z.string().nullable(),
}) satisfies z.ZodType<DataPoint>;
