import type { IsoDateTime, Uuid } from './common.js';
import type {
  Dataset,
  DatasetPeriod,
  DatasetVersion,
  InterpolationOptions,
  MetricConfiguration,
  ProcessingOptions,
} from './dataset.js';
import type { RankedValue, ValidationIssue, ValidationReport } from './processing.js';
import type {
  RenderJob,
  RenderJobEvent,
  RenderManifest,
  RenderRequest,
  VideoOutput,
} from './render.js';
import type { OutputFormat, VideoConfiguration, VideoProject } from './video.js';

/** Body of `POST /api/datasets`. Omitted configuration falls back to platform defaults. */
export interface CreateDatasetRequest {
  title: string;
  /** Derived from the title when omitted. */
  slug?: string | undefined;
  description?: string | null | undefined;
  topicId?: string | null | undefined;
  unit?: string | null | undefined;
  metric?: Partial<MetricConfiguration> | undefined;
  processing?: ProcessingOptionsPatch | undefined;
}

/** Partial processing options; `interpolation` may itself be partial. */
export interface ProcessingOptionsPatch {
  topN?: number | null | undefined;
  missingValues?: ProcessingOptions['missingValues'] | undefined;
  interpolation?: Partial<InterpolationOptions> | undefined;
}

/** Body of `POST /api/datasets/:id/versions/:versionId/reprocess`. */
export interface ReprocessRequest {
  metric?: MetricConfiguration | undefined;
  processing?: ProcessingOptions | undefined;
}

export interface DatasetListItem extends Dataset {
  versionCount: number;
  latestVersion: DatasetVersion | null;
}

export interface DatasetListResponse {
  datasets: DatasetListItem[];
}

export interface DatasetDetailResponse {
  dataset: Dataset;
  latestVersion: DatasetVersion | null;
  /** Most recent upload, whatever its status. */
  lastUpload: DatasetVersion | null;
  versionCount: number;
}

export interface DatasetVersionsResponse {
  versions: DatasetVersion[];
}

/** Result of `import`, `reprocess` (a stored version) and `validate` (a dry run, no version). */
export interface ImportResponse {
  version: DatasetVersion;
  report: ValidationReport;
}

export interface ValidateResponse {
  report: ValidationReport;
}

export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
}

export interface PreviewRankingEntry extends RankedValue {
  name: string;
  category: string | null;
}

export interface PreviewObservation {
  row: number;
  entityId: string;
  entityName: string;
  period: DatasetPeriod;
  value: number | null;
  sourceId: string;
  notes: string | null;
}

/** `GET /api/datasets/:id/preview`: one version's quality report, ranking and records. */
export interface DatasetPreviewResponse {
  dataset: Dataset;
  version: DatasetVersion;
  unit: string | null;
  /** Every period of the version (empty when it has no normalized output). */
  periods: DatasetPeriod[];
  /** The period `ranking` is for. */
  period: DatasetPeriod | null;
  top: number;
  ranking: PreviewRankingEntry[];
  issues: Page<ValidationIssue>;
  observations: Page<PreviewObservation>;
}

// ─── Projects and rendering ──────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/projects`. Only the dataset version and template are required in the
 * configuration; everything else falls back to platform defaults (title: the dataset title).
 */
export interface CreateProjectRequest {
  name: string;
  topicId?: string | null | undefined;
  configuration: Partial<VideoConfiguration> &
    Pick<VideoConfiguration, 'datasetVersionId' | 'templateId'>;
}

/** Body of `PUT /api/projects/:id`: the complete new state plus the revision it was based on. */
export interface UpdateProjectRequest {
  revision: number;
  name: string;
  topicId: string | null;
  configuration: VideoConfiguration;
}

export interface ProjectDetailResponse {
  project: VideoProject;
  /** Most recent render requests, newest first. */
  renders: RenderRequest[];
  jobs: RenderJob[];
  outputs: VideoOutput[];
}

export interface ProjectListResponse {
  projects: VideoProject[];
}

/** Body of `POST /api/projects/:id/preview` and `/render`. */
export interface SubmitRenderRequest {
  /** Subset of the project's output mode; defaults to all of its formats. */
  formats?: OutputFormat[] | undefined;
}

export interface RenderSubmissionResponse {
  request: RenderRequest;
  /** True when an earlier identical submission (same idempotency key) was returned. */
  replayed: boolean;
}

export interface RenderRequestDetailResponse {
  request: RenderRequest;
  outputs: VideoOutput[];
}

export interface JobDetailResponse {
  job: RenderJob;
  manifest: RenderManifest;
  output: VideoOutput | null;
  /** Most recent render log entries, oldest first. */
  events: RenderJobEvent[];
}

/** `GET /api/stats`: totals for the dashboard overview. */
export interface DashboardStats {
  datasets: number;
  projects: number;
  renders: {
    completed: number;
    /** Jobs not finished yet (waiting or running). */
    pending: number;
    failed: number;
    cancelled: number;
  };
  outputs: number;
  storage: {
    /** Bytes used per top-level storage area (datasets, renders, …). */
    areas: { area: string; bytes: number; files: number }[];
    usedBytes: number;
    /** Size and free space of the volume holding storage, when the OS reports them. */
    volumeBytes: number | null;
    freeBytes: number | null;
    measuredAt: IsoDateTime;
  };
}

/** A generated video with what it was made from (`GET /api/outputs`). */
export interface OutputListItem extends VideoOutput {
  title: string;
  projectName: string;
  datasetId: Uuid;
  datasetTitle: string;
  datasetVersionId: Uuid;
  datasetVersion: number;
}

export interface OutputListResponse {
  outputs: OutputListItem[];
}

/** `GET /api/jobs`. */
export interface JobListResponse {
  jobs: RenderJob[];
}
