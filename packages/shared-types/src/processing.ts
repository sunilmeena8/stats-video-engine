import type { IsoDateTime, Uuid } from './common.js';
import type {
  DataFrequency,
  DatasetPeriod,
  InterpolationOptions,
  MetricConfiguration,
  ProcessingOptions,
  ProcessingSummary,
  ValidationStatus,
} from './dataset.js';

/** Columns every dataset CSV must have, in any order. */
export const CSV_REQUIRED_COLUMNS = [
  'entity_id',
  'entity_name',
  'year',
  'value',
  'unit',
  'source_id',
] as const;
export const CSV_OPTIONAL_COLUMNS = [
  'entity_image',
  'entity_category',
  'source_url',
  'notes',
] as const;
export type CsvColumn =
  (typeof CSV_REQUIRED_COLUMNS)[number] | (typeof CSV_OPTIONAL_COLUMNS)[number];

export const ISSUE_SEVERITIES = ['error', 'warning'] as const;
/** `error` blocks the import; `warning` is reported and the import continues. */
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** Blocking problems: a version with any of these is `invalid` and produces no output. */
export const VALIDATION_ERROR_CODES = [
  'FILE_EMPTY',
  'FILE_NOT_UTF8',
  'FILE_BINARY',
  'CSV_MALFORMED',
  'MISSING_COLUMNS',
  'DUPLICATE_COLUMNS',
  'NO_DATA_ROWS',
  'TOO_MANY_ROWS',
  'FIELD_COUNT_MISMATCH',
  'FIELD_TOO_LONG',
  'INVALID_ID',
  'MISSING_ENTITY_ID',
  'MISSING_ENTITY_NAME',
  'MISSING_PERIOD',
  'INVALID_PERIOD',
  'INVALID_VALUE',
  'NEGATIVE_VALUE',
  'MISSING_UNIT',
  'MISSING_SOURCE_ID',
  'DUPLICATE_OBSERVATION',
  'INCONSISTENT_UNIT',
  'INCONSISTENT_ENTITY_NAME',
  'OUTPUT_TOO_LARGE',
] as const;

/** Non-blocking findings, reported alongside the output. */
export const VALIDATION_WARNING_CODES = [
  'UNEXPECTED_COLUMNS',
  'BLANK_ROW',
  'MISSING_VALUE',
  'MISSING_PERIODS',
  'EMPTY_PERIOD',
  'INVALID_SOURCE_URL',
  'INCONSISTENT_SOURCE_URL',
  'INVALID_IMAGE_URL',
  'INCONSISTENT_ENTITY_METADATA',
  'UNIT_CHANGED',
  'GAP_NOT_INTERPOLATED',
] as const;

export type ValidationIssueCode =
  (typeof VALIDATION_ERROR_CODES)[number] | (typeof VALIDATION_WARNING_CODES)[number];

export interface ValidationIssue {
  severity: IssueSeverity;
  code: ValidationIssueCode;
  message: string;
  /** CSV row number (header = row 1), or null for file-level issues. */
  row: number | null;
  column: string | null;
  entityId: string | null;
  /** The offending cell value, truncated for display. */
  value: string | null;
}

export interface CsvColumnReport {
  found: string[];
  missing: string[];
  unexpected: string[];
}

/** Result of validating one CSV. `issues` may be truncated; the counts in `summary` never are. */
export interface ValidationReport {
  status: Exclude<ValidationStatus, 'pending'>;
  columns: CsvColumnReport;
  summary: ProcessingSummary;
  issues: ValidationIssue[];
  issuesTruncated: boolean;
}

// ─── Normalized output ──────────────────────────────────────────────────────────────────────

export const NORMALIZED_DATASET_SCHEMA_VERSION = 1;

export interface NormalizedDatasetInfo {
  id: Uuid;
  slug: string;
  title: string;
  description: string | null;
  versionId: Uuid;
  version: number;
  originalFilename: string;
  checksumSha256: string;
}

export interface NormalizedMetric extends MetricConfiguration {
  unit: string;
}

export interface NormalizedTimeRange {
  frequency: DataFrequency;
  start: DatasetPeriod;
  end: DatasetPeriod;
  /** Every calendar period from start to end, in order (including periods without data). */
  periods: DatasetPeriod[];
}

export interface NormalizedEntity {
  /** The CSV `entity_id`. */
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  firstPeriod: DatasetPeriod;
  lastPeriod: DatasetPeriod;
  observationCount: number;
  /** Periods between first and last observation with no row, or with an empty value. */
  missingPeriods: DatasetPeriod[];
}

export interface NormalizedSource {
  /** The CSV `source_id`. */
  id: string;
  url: string | null;
  observationCount: number;
}

/** An original CSV observation, unchanged. */
export interface NormalizedObservation {
  entityId: string;
  period: DatasetPeriod;
  value: number | null;
  sourceId: string;
  /** CSV row number (header = row 1). */
  row: number;
  notes: string | null;
}

export const VALUE_KINDS = ['observed', 'zero_filled', 'interpolated'] as const;
/** `interpolated` values are visual estimates and only appear in animation frames. */
export type ValueKind = (typeof VALUE_KINDS)[number];

export interface RankedValue {
  entityId: string;
  value: number;
  /** Competition rank: tied values share a rank (1, 2, 2, 4). */
  rank: number;
  /** Unique 1-based display order; ties are broken by entity id. */
  position: number;
  valueKind: ValueKind;
}

export interface PeriodRanking {
  period: DatasetPeriod;
  entries: RankedValue[];
  /** In this period's ranking but not the previous period's. */
  entered: string[];
  /** In the previous period's ranking but not this one's. */
  exited: string[];
}

export interface InterpolationGap {
  entityId: string;
  /** Last observed period before the gap. */
  from: DatasetPeriod;
  /** First observed period after the gap. */
  to: DatasetPeriod;
  missingPeriods: number;
}

export interface InterpolationMetadata extends InterpolationOptions {
  frameCount: number;
  /** Frame entries whose value is a visual estimate. */
  estimatedValueCount: number;
  bridgedGaps: InterpolationGap[];
  /** Gaps longer than `maxGapPeriods` that were left empty. */
  skippedGaps: InterpolationGap[];
}

export interface AnimationFrame {
  index: number;
  fromPeriod: DatasetPeriod;
  /** Null for the final frame. */
  toPeriod: DatasetPeriod | null;
  /** Position between `fromPeriod` (0) and `toPeriod` (1). */
  progress: number;
  /** True when any value in the frame is interpolated: a visual estimate, not a measurement. */
  isEstimate: boolean;
  entries: RankedValue[];
}

export interface NormalizedQuality {
  status: 'valid' | 'valid_with_warnings';
  summary: ProcessingSummary;
  warnings: ValidationIssue[];
  warningsTruncated: boolean;
}

/** Animation-ready dataset written by the data-processor to `DatasetVersion.processedFilePath`. */
export interface NormalizedDataset {
  schemaVersion: typeof NORMALIZED_DATASET_SCHEMA_VERSION;
  generatedAt: IsoDateTime;
  generator: { name: string; version: string };
  dataset: NormalizedDatasetInfo;
  metric: NormalizedMetric;
  processing: ProcessingOptions;
  timeRange: NormalizedTimeRange;
  entities: NormalizedEntity[];
  sources: NormalizedSource[];
  observations: NormalizedObservation[];
  rankings: PeriodRanking[];
  interpolation: InterpolationMetadata;
  frames: AnimationFrame[];
  quality: NormalizedQuality;
}
