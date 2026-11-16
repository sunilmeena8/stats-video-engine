import {
  barChartRaceConfigSchema,
  musicLicenseSnapshotSchema,
  qualityReportSchema,
  renderMetadataSchema,
} from '@statsopedia/shared-schemas';
import {
  isTerminalRenderStatus,
  type BarChartRaceConfig,
  type OutputFormat,
  type OutputListItem,
  type RenderErrorCode,
  type RenderJob,
  type RenderJobEvent,
  type RenderJobStatus,
  type RenderKind,
  type RenderManifest,
  type RenderMetadata,
  type RenderRequest,
  type RenderRequestStatus,
  type RenderRequestType,
  type VideoCodec,
  type VideoOutput,
} from '@statsopedia/shared-types';

import { iso, type Queryable } from './db.js';

const round1 = (value: number) => Math.round(value * 10) / 10;
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

// ─── Manifests ───────────────────────────────────────────────────────────────────────────────

interface ManifestRow {
  id: string;
  project_id: string;
  kind: RenderKind;
  output_format: OutputFormat;
  composition_id: string;
  template_id: string;
  template_version: number;
  dataset_version_id: string;
  music_asset_id: string | null;
  music_license: unknown;
  quality: unknown;
  race_config: unknown;
  props_checksum: string;
  thumbnail_frame: number | null;
  created_at: Date;
}

/** A manifest as stored: the race config still holds `storage:` music references. */
export interface ManifestRecord extends Omit<RenderManifest, 'raceConfig'> {
  raceConfig: BarChartRaceConfig;
  /** Frame captured as the thumbnail (the last chart frame), or null for none. */
  thumbnailFrame: number | null;
}

const toManifest = (row: ManifestRow): ManifestRecord => ({
  id: row.id,
  projectId: row.project_id,
  kind: row.kind,
  outputFormat: row.output_format,
  compositionId: row.composition_id,
  templateId: row.template_id,
  templateVersion: row.template_version,
  datasetVersionId: row.dataset_version_id,
  musicAssetId: row.music_asset_id,
  musicLicense: musicLicenseSnapshotSchema.nullable().parse(row.music_license),
  quality: qualityReportSchema.nullable().parse(row.quality),
  raceConfig: barChartRaceConfigSchema.parse(row.race_config),
  propsChecksum: row.props_checksum,
  createdAt: row.created_at.toISOString(),
  thumbnailFrame: row.thumbnail_frame,
});

/**
 * Strips storage details from a manifest. The music source is a `storage:` reference the worker
 * resolves; clients get the asset's download URL instead.
 */
export function publicManifest(record: ManifestRecord): RenderManifest {
  const { thumbnailFrame: _frame, raceConfig, ...manifest } = record;
  const { music, ...config } = raceConfig;
  let publicMusic: RenderManifest['raceConfig']['music'] = null;
  if (music && record.musicAssetId) {
    const { src: _src, ...settings } = music;
    publicMusic = { ...settings, downloadUrl: `/api/media/${record.musicAssetId}/file` };
  }
  // Uploaded annotation images go back to the `media:<id>` form projects use.
  const annotations = config.annotations.map((annotation) => {
    const match = /^storage:assets\/[a-z]+\/([0-9a-f-]{36})\.[a-z0-9]+$/.exec(
      annotation.imageUrl ?? '',
    );
    return match ? { ...annotation, imageUrl: `media:${match[1]}` } : annotation;
  });
  return { ...manifest, raceConfig: { ...config, annotations, music: publicMusic } };
}

export async function insertManifest(db: Queryable, manifest: ManifestRecord): Promise<void> {
  await db.query(
    `INSERT INTO render_manifests (id, project_id, kind, output_format, composition_id,
       template_id, template_version, dataset_version_id, music_asset_id, race_config,
       props_checksum, thumbnail_frame, music_license, quality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      manifest.id,
      manifest.projectId,
      manifest.kind,
      manifest.outputFormat,
      manifest.compositionId,
      manifest.templateId,
      manifest.templateVersion,
      manifest.datasetVersionId,
      manifest.musicAssetId,
      JSON.stringify(manifest.raceConfig),
      manifest.propsChecksum,
      manifest.thumbnailFrame,
      manifest.musicLicense ? JSON.stringify(manifest.musicLicense) : null,
      manifest.quality ? JSON.stringify(manifest.quality) : null,
    ],
  );
}

export async function getManifest(db: Queryable, id: string): Promise<ManifestRecord | null> {
  const { rows } = await db.query<ManifestRow>('SELECT * FROM render_manifests WHERE id = $1', [
    id,
  ]);
  return rows[0] ? toManifest(rows[0]) : null;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  request_id: string;
  project_id: string;
  manifest_id: string;
  kind: RenderKind;
  output_format: OutputFormat;
  render_version: number;
  queue_name: string;
  status: RenderJobStatus;
  percent: number;
  message: string | null;
  attempts: number;
  max_attempts: number;
  error_code: RenderErrorCode | null;
  error_message: string | null;
  cancel_requested_at: Date | null;
  output_key: string;
  worker_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  output_id: string | null;
}

/** A job as stored, including where its output goes (never sent to clients). */
export interface JobRecord extends RenderJob {
  queueName: string;
  outputKey: string;
  workerId: string | null;
}

const toJob = (row: JobRow): JobRecord => ({
  id: row.id,
  requestId: row.request_id,
  projectId: row.project_id,
  manifestId: row.manifest_id,
  kind: row.kind,
  outputFormat: row.output_format,
  renderVersion: row.render_version,
  status: row.status,
  percent: round1(row.percent),
  message: row.message,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  cancelRequestedAt: iso(row.cancel_requested_at),
  createdBy: row.created_by,
  startedAt: iso(row.started_at),
  finishedAt: iso(row.finished_at),
  outputId: row.output_id,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  queueName: row.queue_name,
  outputKey: row.output_key,
  workerId: row.worker_id,
});

export function publicJob(record: JobRecord): RenderJob {
  const { queueName: _q, outputKey: _o, workerId: _w, ...job } = record;
  return job;
}

const JOB_SELECT = `
  SELECT j.*, o.id AS output_id
    FROM render_jobs j LEFT JOIN video_outputs o ON o.render_job_id = j.id`;

/** SQL list of unfinished statuses. */
export const ACTIVE_STATUS_SQL = `('pending','validating','preparing','rendering','post_processing')`;

export interface NewJob {
  id: string;
  requestId: string;
  projectId: string;
  manifestId: string;
  kind: RenderKind;
  outputFormat: OutputFormat;
  renderVersion: number;
  outputKey: string;
  queueName: string;
  maxAttempts: number;
  createdBy: string | null;
}

export async function insertJob(db: Queryable, job: NewJob): Promise<void> {
  await db.query(
    `INSERT INTO render_jobs (id, request_id, project_id, manifest_id, kind, output_format,
       render_version, output_key, queue_name, status, percent, message, max_attempts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',0,'Waiting for a render worker',$10,$11)`,
    [
      job.id,
      job.requestId,
      job.projectId,
      job.manifestId,
      job.kind,
      job.outputFormat,
      job.renderVersion,
      job.outputKey,
      job.queueName,
      job.maxAttempts,
      job.createdBy,
    ],
  );
}

export async function getJob(db: Queryable, id: string, lock = false): Promise<JobRecord | null> {
  const { rows } = lock
    ? await db.query<JobRow>(
        `SELECT *, (SELECT o.id FROM video_outputs o WHERE o.render_job_id = j.id) AS output_id
           FROM render_jobs j WHERE j.id = $1 FOR UPDATE`,
        [id],
      )
    : await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function jobsForRequest(db: Queryable, requestId: string): Promise<JobRecord[]> {
  const { rows } = await db.query<JobRow>(
    `${JOB_SELECT} WHERE j.request_id = $1 ORDER BY j.output_format`,
    [requestId],
  );
  return rows.map(toJob);
}

/** An unfinished job of the same project, kind and format rendering identical props. */
export async function findActiveDuplicate(
  db: Queryable,
  projectId: string,
  kind: RenderKind,
  format: OutputFormat,
  propsChecksum: string,
): Promise<JobRecord | null> {
  const { rows } = await db.query<JobRow>(
    `${JOB_SELECT} JOIN render_manifests m ON m.id = j.manifest_id
      WHERE j.project_id = $1 AND j.kind = $2 AND j.output_format = $3
        AND m.props_checksum = $4 AND j.status IN ${ACTIVE_STATUS_SQL}
      ORDER BY j.created_at DESC LIMIT 1`,
    [projectId, kind, format, propsChecksum],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export interface JobFilter {
  projectId?: string | undefined;
  status?: RenderJobStatus | undefined;
  limit: number;
}

export async function listJobs(db: Queryable, filter: JobFilter): Promise<JobRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`j.project_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`j.status = $${params.length}`);
  }
  params.push(filter.limit);
  const { rows } = await db.query<JobRow>(
    `${JOB_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY j.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toJob);
}

/** Jobs PostgreSQL still considers unfinished (for reconciliation with the queue). */
export async function listUnfinishedJobs(db: Queryable): Promise<JobRecord[]> {
  const { rows } = await db.query<JobRow>(
    `${JOB_SELECT} WHERE j.status IN ${ACTIVE_STATUS_SQL} ORDER BY j.created_at`,
  );
  return rows.map(toJob);
}

// ─── Requests ────────────────────────────────────────────────────────────────────────────────

interface RequestRow {
  id: string;
  project_id: string;
  type: RenderRequestType;
  kind: RenderKind;
  formats: OutputFormat[];
  render_version: number;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface RequestRecord {
  id: string;
  projectId: string;
  type: RenderRequestType;
  kind: RenderKind;
  formats: OutputFormat[];
  renderVersion: number;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
  createdBy: string | null;
  createdAt: string;
}

const toRequest = (row: RequestRow): RequestRecord => ({
  id: row.id,
  projectId: row.project_id,
  type: row.type,
  kind: row.kind,
  formats: row.formats,
  renderVersion: row.render_version,
  idempotencyKey: row.idempotency_key,
  requestFingerprint: row.request_fingerprint,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

/** What a submission asks for, named the way people think about it. */
export function requestTypeFor(
  kind: RenderKind,
  formats: readonly OutputFormat[],
): RenderRequestType {
  if (kind === 'preview') return 'preview';
  if (formats.length === 2) return 'both';
  return formats[0] === 'long' ? 'long_form' : 'short';
}

/**
 * Overall status and progress of a request's jobs. Progress is the average of the jobs, with
 * finished jobs counting as 100, so a "both" request reaches 100 when both outputs are done.
 */
export function aggregateJobs(jobs: readonly Pick<RenderJob, 'status' | 'percent'>[]): {
  status: RenderRequestStatus;
  percent: number;
} {
  if (jobs.length === 0) return { status: 'pending', percent: 0 };
  const percent = round1(
    jobs.reduce((sum, job) => sum + (isTerminalRenderStatus(job.status) ? 100 : job.percent), 0) /
      jobs.length,
  );
  const count = (status: RenderJobStatus) => jobs.filter((job) => job.status === status).length;
  if (jobs.some((job) => !isTerminalRenderStatus(job.status))) {
    return { status: count('pending') === jobs.length ? 'pending' : 'in_progress', percent };
  }
  const completed = count('completed');
  if (completed === jobs.length) return { status: 'completed', percent };
  if (completed > 0) return { status: 'partial', percent };
  return { status: count('cancelled') === jobs.length ? 'cancelled' : 'failed', percent };
}

export function publicRequest(record: RequestRecord, jobs: readonly JobRecord[]): RenderRequest {
  const { requestFingerprint: _f, ...request } = record;
  return { ...request, ...aggregateJobs(jobs), jobs: jobs.map(publicJob) };
}

export async function insertRequest(db: Queryable, request: RequestRecord): Promise<void> {
  await db.query(
    `INSERT INTO render_requests (id, project_id, type, kind, formats, render_version,
       idempotency_key, request_fingerprint, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      request.id,
      request.projectId,
      request.type,
      request.kind,
      request.formats,
      request.renderVersion,
      request.idempotencyKey,
      request.requestFingerprint,
      request.createdBy,
    ],
  );
}

export async function getRequest(db: Queryable, id: string): Promise<RequestRecord | null> {
  const { rows } = await db.query<RequestRow>('SELECT * FROM render_requests WHERE id = $1', [id]);
  return rows[0] ? toRequest(rows[0]) : null;
}

export async function requestByIdempotencyKey(
  db: Queryable,
  projectId: string,
  kind: RenderKind,
  key: string,
): Promise<RequestRecord | null> {
  const { rows } = await db.query<RequestRow>(
    'SELECT * FROM render_requests WHERE project_id = $1 AND kind = $2 AND idempotency_key = $3',
    [projectId, kind, key],
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

export async function requestsForProject(
  db: Queryable,
  projectId: string,
  limit = 20,
): Promise<RequestRecord[]> {
  const { rows } = await db.query<RequestRow>(
    'SELECT * FROM render_requests WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
    [projectId, limit],
  );
  return rows.map(toRequest);
}

/** A request with its jobs, as clients see it. */
export async function loadPublicRequest(db: Queryable, id: string): Promise<RenderRequest | null> {
  const request = await getRequest(db, id);
  return request ? publicRequest(request, await jobsForRequest(db, id)) : null;
}

// ─── Events (render log) ─────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  render_job_id: string;
  at: Date;
  level: RenderJobEvent['level'];
  status: RenderJobStatus;
  percent: number;
  message: string;
}

const toEvent = (row: EventRow): RenderJobEvent => ({
  id: Number(row.id),
  renderJobId: row.render_job_id,
  at: row.at.toISOString(),
  level: row.level,
  status: row.status,
  percent: round1(row.percent),
  message: row.message,
});

export async function insertEvent(
  db: Queryable,
  event: Omit<RenderJobEvent, 'id' | 'at'>,
): Promise<RenderJobEvent> {
  const { rows } = await db.query<EventRow>(
    `INSERT INTO render_job_events (render_job_id, level, status, percent, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      event.renderJobId,
      event.level,
      event.status,
      clampPercent(event.percent),
      event.message.slice(0, 2_000),
    ],
  );
  return toEvent(rows[0]!);
}

/** Events after `afterId` (oldest first), for SSE replay; or the latest `limit` events. */
export async function listEvents(
  db: Queryable,
  jobIds: string | readonly string[],
  { afterId, limit }: { afterId?: number | undefined; limit: number },
): Promise<RenderJobEvent[]> {
  const ids = typeof jobIds === 'string' ? [jobIds] : [...jobIds];
  const { rows } =
    afterId === undefined
      ? await db.query<EventRow>(
          `SELECT * FROM (SELECT * FROM render_job_events WHERE render_job_id = ANY($1::uuid[])
             ORDER BY id DESC LIMIT $2) recent ORDER BY id`,
          [ids, limit],
        )
      : await db.query<EventRow>(
          `SELECT * FROM render_job_events WHERE render_job_id = ANY($1::uuid[]) AND id > $2
            ORDER BY id LIMIT $3`,
          [ids, afterId, limit],
        );
  return rows.map(toEvent);
}

// ─── Outputs ─────────────────────────────────────────────────────────────────────────────────

interface OutputRow {
  id: string;
  render_job_id: string;
  project_id: string;
  kind: RenderKind;
  format: OutputFormat;
  render_version: number;
  storage_key: string;
  thumbnail_key: string | null;
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
  size_bytes: string;
  checksum_sha256: string;
  codec: VideoCodec;
  metadata: unknown;
  created_at: Date;
}

export interface OutputRecord extends VideoOutput {
  storageKey: string;
  thumbnailKey: string | null;
}

const parseMetadata = (value: unknown): RenderMetadata | null => {
  const parsed = renderMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const toOutput = (row: OutputRow): OutputRecord => ({
  id: row.id,
  renderJobId: row.render_job_id,
  projectId: row.project_id,
  kind: row.kind,
  format: row.format,
  renderVersion: row.render_version,
  width: row.width,
  height: row.height,
  fps: row.fps,
  durationSeconds: row.duration_seconds,
  fileSizeBytes: Number(row.size_bytes),
  codec: row.codec,
  checksumSha256: row.checksum_sha256,
  metadata: parseMetadata(row.metadata),
  downloadUrl: `/api/outputs/${row.id}/download`,
  thumbnailUrl: row.thumbnail_key ? `/api/outputs/${row.id}/thumbnail` : null,
  createdAt: row.created_at.toISOString(),
  storageKey: row.storage_key,
  thumbnailKey: row.thumbnail_key,
});

export function publicOutput(record: OutputRecord): VideoOutput {
  const { storageKey: _s, thumbnailKey: _t, ...output } = record;
  return output;
}

export type NewOutput = Omit<OutputRecord, 'downloadUrl' | 'thumbnailUrl' | 'createdAt'>;

export async function insertOutput(db: Queryable, output: NewOutput): Promise<void> {
  await db.query(
    `INSERT INTO video_outputs (id, render_job_id, project_id, kind, format, render_version,
       storage_key, thumbnail_key, width, height, fps, duration_seconds, size_bytes,
       checksum_sha256, codec, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      output.id,
      output.renderJobId,
      output.projectId,
      output.kind,
      output.format,
      output.renderVersion,
      output.storageKey,
      output.thumbnailKey,
      output.width,
      output.height,
      output.fps,
      output.durationSeconds,
      output.fileSizeBytes,
      output.checksumSha256,
      output.codec,
      output.metadata === null ? null : JSON.stringify(output.metadata),
    ],
  );
}

export async function getOutput(db: Queryable, id: string): Promise<OutputRecord | null> {
  const { rows } = await db.query<OutputRow>('SELECT * FROM video_outputs WHERE id = $1', [id]);
  return rows[0] ? toOutput(rows[0]) : null;
}

export async function outputForJob(db: Queryable, jobId: string): Promise<OutputRecord | null> {
  const { rows } = await db.query<OutputRow>(
    'SELECT * FROM video_outputs WHERE render_job_id = $1',
    [jobId],
  );
  return rows[0] ? toOutput(rows[0]) : null;
}

/** Whether a stored output already uses this file (a finished file is never replaced). */
export async function outputExistsForKey(db: Queryable, storageKey: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM video_outputs WHERE storage_key = $1', [
    storageKey,
  ]);
  return rows.length > 0;
}

export async function outputsForProject(db: Queryable, projectId: string): Promise<OutputRecord[]> {
  const { rows } = await db.query<OutputRow>(
    'SELECT * FROM video_outputs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100',
    [projectId],
  );
  return rows.map(toOutput);
}

export async function outputsForRequest(db: Queryable, requestId: string): Promise<OutputRecord[]> {
  const { rows } = await db.query<OutputRow>(
    `SELECT o.* FROM video_outputs o JOIN render_jobs j ON j.id = o.render_job_id
      WHERE j.request_id = $1 ORDER BY o.format`,
    [requestId],
  );
  return rows.map(toOutput);
}

/** Outputs with their title, project and dataset version, newest first (generated videos). */
export async function listOutputItems(
  db: Queryable,
  filter: { kind?: RenderKind | undefined; projectId?: string | undefined; limit: number },
): Promise<OutputListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    params.push(filter.kind);
    where.push(`o.kind = $${params.length}`);
  }
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`o.project_id = $${params.length}`);
  }
  params.push(filter.limit);
  const { rows } = await db.query<
    OutputRow & {
      title: string;
      project_name: string;
      dataset_id: string;
      dataset_title: string;
      dataset_version_id: string;
      dataset_version: number;
    }
  >(
    `SELECT o.*, m.race_config->>'title' AS title, p.name AS project_name,
            d.id AS dataset_id, d.title AS dataset_title,
            v.id AS dataset_version_id, v.version AS dataset_version
       FROM video_outputs o
       JOIN render_jobs j ON j.id = o.render_job_id
       JOIN render_manifests m ON m.id = j.manifest_id
       JOIN video_projects p ON p.id = o.project_id
       JOIN dataset_versions v ON v.id = m.dataset_version_id
       JOIN datasets d ON d.id = v.dataset_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => ({
    ...publicOutput(toOutput(row)),
    title: row.title,
    projectName: row.project_name,
    datasetId: row.dataset_id,
    datasetTitle: row.dataset_title,
    datasetVersionId: row.dataset_version_id,
    datasetVersion: row.dataset_version,
  }));
}
