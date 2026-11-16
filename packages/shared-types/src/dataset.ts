import type { IsoDateTime, Timestamps, Uuid, YearRange } from './common.js';

/** Processing lifecycle of a dataset version. */
export const DATASET_VERSION_STATUSES = ['uploaded', 'processing', 'ready', 'failed'] as const;
export type DatasetVersionStatus = (typeof DATASET_VERSION_STATUSES)[number];

/** Outcome of validating a version's CSV. `invalid` means it has blocking errors. */
export const VALIDATION_STATUSES = ['pending', 'valid', 'valid_with_warnings', 'invalid'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const DATASET_ENTITY_TYPES = [
  'country',
  'region',
  'company',
  'person',
  'organization',
  'other',
] as const;
export type DatasetEntityType = (typeof DATASET_ENTITY_TYPES)[number];

/** How often the source statistic is observed. Decides the period format (see `DatasetPeriod`). */
export const DATA_FREQUENCIES = ['yearly', 'monthly', 'daily'] as const;
export type DataFrequency = (typeof DATA_FREQUENCIES)[number];

/**
 * One time point of a dataset, as written in the CSV `year` column:
 * yearly `YYYY` (negative = BCE, e.g. `-500`), monthly `YYYY-MM`, daily `YYYY-MM-DD`.
 */
export type DatasetPeriod = string;

/** Inclusive range of periods, in the dataset's frequency. */
export interface PeriodRange {
  start: DatasetPeriod;
  end: DatasetPeriod;
}

export const RANKING_ORDERS = ['desc', 'asc'] as const;
/** `desc`: the largest value ranks first (default). `asc`: the smallest value ranks first. */
export type RankingOrder = (typeof RANKING_ORDERS)[number];

/** Properties of the statistic itself. */
export interface MetricConfiguration {
  frequency: DataFrequency;
  rankingOrder: RankingOrder;
  /** When false, negative values are blocking errors. */
  allowNegative: boolean;
}

export const MISSING_VALUE_POLICIES = ['exclude', 'zero'] as const;
/**
 * `exclude`: an entity without a value in a period is not ranked in that period.
 * `zero`: it is ranked with value 0 (only when explicitly configured).
 */
export type MissingValuePolicy = (typeof MISSING_VALUE_POLICIES)[number];

export const INTERPOLATION_METHODS = ['none', 'linear'] as const;
export type InterpolationMethod = (typeof INTERPOLATION_METHODS)[number];

/** Visual interpolation between known observations. Original observations are never changed. */
export interface InterpolationOptions {
  method: InterpolationMethod;
  /** Animation frames per period transition (1 = one frame per period). */
  stepsPerPeriod: number;
  /** Longest run of missing periods that may be bridged with estimates. */
  maxGapPeriods: number;
  /** Explicit permission to bridge gaps longer than `maxGapPeriods`. */
  allowLargeGaps: boolean;
}

/** How a version is turned into rankings and animation frames. Recorded on every version. */
export interface ProcessingOptions {
  /** Entities kept per period in rankings and frames; null keeps every entity. */
  topN: number | null;
  missingValues: MissingValuePolicy;
  interpolation: InterpolationOptions;
}

/** Where a dataset's numbers come from. Shown in video descriptions for attribution. */
export interface DataSource extends Timestamps {
  id: Uuid;
  /** The CSV `source_id`, unique across the platform (e.g. `world-bank-wdi`). */
  key: string;
  name: string;
  publisher: string | null;
  url: string | null;
  license: string | null;
  /** When the source was last retrieved, for citations. */
  accessedAt: IsoDateTime | null;
  notes: string | null;
}

/** A logical statistic tracked over time, e.g. "GDP by country". Its data lives in versions. */
export interface Dataset extends Timestamps {
  id: Uuid;
  slug: string;
  title: string;
  description: string | null;
  topicId: Uuid | null;
  /** Unit of every value, e.g. "USD (current)". Null until the first valid import sets it. */
  unit: string | null;
  /** Defaults applied to new versions. */
  metric: MetricConfiguration;
  processing: ProcessingOptions;
  dataSourceIds: Uuid[];
  /** Most recent version that processed successfully. */
  latestVersionId: Uuid | null;
}

/** Counts describing one validation/processing run. */
export interface ProcessingSummary {
  /** Data rows in the CSV (header excluded). */
  rowCount: number;
  /** Rows without blocking errors. */
  validRowCount: number;
  entityCount: number;
  sourceCount: number;
  /** Calendar periods between the first and last observed period. */
  periodCount: number;
  observedPeriodCount: number;
  /** Rows whose value cell is empty (kept as missing observations, never zero). */
  missingValueCount: number;
  errorCount: number;
  warningCount: number;
  issueCounts: Record<string, number>;
  durationMs: number;
}

/**
 * One uploaded CSV for a dataset plus the result of processing it. Versions are never edited:
 * reprocessing creates a new version that points at the same original file.
 */
export interface DatasetVersion {
  id: Uuid;
  datasetId: Uuid;
  /** Monotonically increasing per dataset, starting at 1. */
  version: number;
  status: DatasetVersionStatus;
  validationStatus: ValidationStatus;
  /** Set when this version reprocesses another version's original file. */
  sourceVersionId: Uuid | null;
  /** Sanitized client filename, for display only. Storage paths are server-generated. */
  originalFilename: string;
  sizeBytes: number;
  /**
   * True when the data-processor wrote the normalized, animation-ready dataset. The files
   * themselves (original CSV, normalized JSON, full report) live in server storage and are
   * never exposed by path.
   */
  hasNormalizedOutput: boolean;
  checksumSha256: string;
  metric: MetricConfiguration;
  processing: ProcessingOptions;
  rowCount: number | null;
  entityCount: number | null;
  periodRange: PeriodRange | null;
  yearRange: YearRange | null;
  errorCount: number | null;
  warningCount: number | null;
  summary: ProcessingSummary | null;
  errorMessage: string | null;
  /** Upload timestamp. */
  createdAt: IsoDateTime;
  processedAt: IsoDateTime | null;
}

/** A ranked subject within a dataset version (a country, company, person, ...). */
export interface DatasetEntity {
  id: Uuid;
  datasetVersionId: Uuid;
  /** The CSV `entity_id`, preserved exactly so entities stay stable across versions. */
  key: string;
  name: string;
  type: DatasetEntityType;
  category: string | null;
  /** The CSV `entity_image` (http/https URL). */
  imageUrl: string | null;
  /** ISO 3166-1 alpha-3 code, for countries. */
  isoCode: string | null;
  /** Preferred bar color as `#RRGGBB`. */
  color: string | null;
  logoAssetId: Uuid | null;
}

/**
 * One original observation from the CSV. Identified by (datasetVersionId, entityId, period).
 * Interpolated values are never stored here; they exist only as estimates in animation frames.
 */
export interface DataPoint {
  datasetVersionId: Uuid;
  entityId: Uuid;
  period: DatasetPeriod;
  /** Calendar year of `period`. */
  year: number;
  /** Null when the CSV value cell is empty (a missing value, not zero). */
  value: number | null;
  dataSourceId: Uuid;
  /** CSV row number (header = row 1). */
  sourceRow: number;
  notes: string | null;
}
