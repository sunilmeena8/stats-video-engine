import {
  DATA_FREQUENCIES,
  ISSUE_SEVERITIES,
  NORMALIZED_DATASET_SCHEMA_VERSION,
  VALIDATION_ERROR_CODES,
  VALIDATION_WARNING_CODES,
  VALUE_KINDS,
  type AnimationFrame,
  type CsvColumnReport,
  type InterpolationGap,
  type InterpolationMetadata,
  type NormalizedDataset,
  type NormalizedEntity,
  type NormalizedObservation,
  type NormalizedSource,
  type PeriodRanking,
  type RankedValue,
  type ValidationIssue,
  type ValidationReport,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import {
  csvKeySchema,
  datasetPeriodSchema,
  interpolationOptionsSchema,
  metricConfigurationSchema,
  processingOptionsSchema,
  processingSummarySchema,
} from './dataset.js';
import {
  httpUrlSchema,
  isoDateTimeSchema,
  sha256Schema,
  slugSchema,
  uuidSchema,
} from './primitives.js';

export const validationIssueCodeSchema = z.enum([
  ...VALIDATION_ERROR_CODES,
  ...VALIDATION_WARNING_CODES,
]);

export const validationIssueSchema = z.object({
  severity: z.enum(ISSUE_SEVERITIES),
  code: validationIssueCodeSchema,
  message: z.string().min(1),
  row: z.int().min(1).nullable(),
  column: z.string().nullable(),
  entityId: z.string().nullable(),
  value: z.string().nullable(),
}) satisfies z.ZodType<ValidationIssue>;

export const csvColumnReportSchema = z.object({
  found: z.array(z.string()),
  missing: z.array(z.string()),
  unexpected: z.array(z.string()),
}) satisfies z.ZodType<CsvColumnReport>;

export const validationReportSchema = z.object({
  status: z.enum(['valid', 'valid_with_warnings', 'invalid']),
  columns: csvColumnReportSchema,
  summary: processingSummarySchema,
  issues: z.array(validationIssueSchema),
  issuesTruncated: z.boolean(),
}) satisfies z.ZodType<ValidationReport>;

const countSchema = z.int().nonnegative();
const finiteNumber = z.number();

export const normalizedEntitySchema = z.object({
  id: csvKeySchema,
  name: z.string().min(1),
  category: z.string().nullable(),
  imageUrl: httpUrlSchema.nullable(),
  firstPeriod: datasetPeriodSchema,
  lastPeriod: datasetPeriodSchema,
  observationCount: countSchema,
  missingPeriods: z.array(datasetPeriodSchema),
}) satisfies z.ZodType<NormalizedEntity>;

export const normalizedSourceSchema = z.object({
  id: csvKeySchema,
  url: httpUrlSchema.nullable(),
  observationCount: countSchema,
}) satisfies z.ZodType<NormalizedSource>;

export const normalizedObservationSchema = z.object({
  entityId: csvKeySchema,
  period: datasetPeriodSchema,
  value: finiteNumber.nullable(),
  sourceId: csvKeySchema,
  row: z.int().min(2),
  notes: z.string().nullable(),
}) satisfies z.ZodType<NormalizedObservation>;

export const rankedValueSchema = z.object({
  entityId: csvKeySchema,
  value: finiteNumber,
  rank: z.int().min(1),
  position: z.int().min(1),
  valueKind: z.enum(VALUE_KINDS),
}) satisfies z.ZodType<RankedValue>;

export const periodRankingSchema = z.object({
  period: datasetPeriodSchema,
  entries: z.array(rankedValueSchema),
  entered: z.array(csvKeySchema),
  exited: z.array(csvKeySchema),
}) satisfies z.ZodType<PeriodRanking>;

export const interpolationGapSchema = z.object({
  entityId: csvKeySchema,
  from: datasetPeriodSchema,
  to: datasetPeriodSchema,
  missingPeriods: z.int().min(1),
}) satisfies z.ZodType<InterpolationGap>;

export const interpolationMetadataSchema = interpolationOptionsSchema.extend({
  frameCount: countSchema,
  estimatedValueCount: countSchema,
  bridgedGaps: z.array(interpolationGapSchema),
  skippedGaps: z.array(interpolationGapSchema),
}) satisfies z.ZodType<InterpolationMetadata>;

export const animationFrameSchema = z.object({
  index: countSchema,
  fromPeriod: datasetPeriodSchema,
  toPeriod: datasetPeriodSchema.nullable(),
  progress: z.number().min(0).lt(1),
  isEstimate: z.boolean(),
  entries: z.array(rankedValueSchema),
}) satisfies z.ZodType<AnimationFrame>;

export const normalizedDatasetSchema = z.object({
  schemaVersion: z.literal(NORMALIZED_DATASET_SCHEMA_VERSION),
  generatedAt: isoDateTimeSchema,
  generator: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  dataset: z.object({
    id: uuidSchema,
    slug: slugSchema,
    title: z.string().min(1),
    description: z.string().nullable(),
    versionId: uuidSchema,
    version: z.int().min(1),
    originalFilename: z.string().min(1),
    checksumSha256: sha256Schema,
  }),
  metric: metricConfigurationSchema.extend({ unit: z.string().min(1) }),
  processing: processingOptionsSchema,
  timeRange: z.object({
    frequency: z.enum(DATA_FREQUENCIES),
    start: datasetPeriodSchema,
    end: datasetPeriodSchema,
    periods: z.array(datasetPeriodSchema).min(1),
  }),
  entities: z.array(normalizedEntitySchema),
  sources: z.array(normalizedSourceSchema),
  observations: z.array(normalizedObservationSchema),
  rankings: z.array(periodRankingSchema),
  interpolation: interpolationMetadataSchema,
  frames: z.array(animationFrameSchema),
  quality: z.object({
    status: z.enum(['valid', 'valid_with_warnings']),
    summary: processingSummarySchema,
    warnings: z.array(validationIssueSchema),
    warningsTruncated: z.boolean(),
  }),
}) satisfies z.ZodType<NormalizedDataset>;
