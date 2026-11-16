import {
  metricConfigurationSchema,
  processingOptionsSchema,
  processingSummarySchema,
} from '@statsopedia/shared-schemas';
import type {
  Dataset,
  DatasetEntityType,
  DatasetListItem,
  DatasetVersion,
  DatasetVersionStatus,
  MetricConfiguration,
  Page,
  PreviewObservation,
  ProcessingOptions,
  ProcessingSummary,
  ValidationStatus,
} from '@statsopedia/shared-types';
import type pg from 'pg';

import type { Queryable } from '../db/database.js';

// ─── Row mapping ─────────────────────────────────────────────────────────────────────────────

interface DatasetRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic_id: string | null;
  unit: string | null;
  metric: unknown;
  processing: unknown;
  latest_version_id: string | null;
  data_source_ids: string[];
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  dataset_id: string;
  version: number;
  status: DatasetVersionStatus;
  validation_status: ValidationStatus;
  source_version_id: string | null;
  original_filename: string;
  source_file_path: string;
  size_bytes: string;
  processed_file_path: string | null;
  report_file_path: string | null;
  checksum_sha256: string;
  metric: unknown;
  processing: unknown;
  row_count: number | null;
  entity_count: number | null;
  period_start: string | null;
  period_end: string | null;
  start_year: number | null;
  end_year: number | null;
  error_count: number | null;
  warning_count: number | null;
  summary: unknown;
  error_message: string | null;
  created_at: Date;
  processed_at: Date | null;
}

const DATASET_COLUMNS = `
  d.id, d.slug, d.title, d.description, d.topic_id, d.unit, d.metric, d.processing, d.latest_version_id,
  d.created_at, d.updated_at,
  COALESCE(
    (SELECT array_agg(ds.data_source_id ORDER BY ds.data_source_id)
       FROM dataset_sources ds WHERE ds.dataset_id = d.id),
    '{}'
  ) AS data_source_ids`;

function toDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    topicId: row.topic_id,
    unit: row.unit,
    // JSON columns are written only by this module; parsing guards against manual edits.
    metric: metricConfigurationSchema.parse(row.metric),
    processing: processingOptionsSchema.parse(row.processing),
    dataSourceIds: row.data_source_ids,
    latestVersionId: row.latest_version_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * A dataset version plus its storage keys. Internal to the API: `publicVersion` strips the keys
 * before anything is sent to a client.
 */
export interface DatasetVersionRecord extends DatasetVersion {
  sourceKey: string;
  normalizedKey: string | null;
  reportKey: string | null;
}

export function publicVersion(record: DatasetVersionRecord): DatasetVersion {
  const { sourceKey: _s, normalizedKey: _n, reportKey: _r, ...version } = record;
  return version;
}

function toVersion(row: VersionRow): DatasetVersionRecord {
  return {
    sourceKey: row.source_file_path,
    normalizedKey: row.processed_file_path,
    reportKey: row.report_file_path,
    hasNormalizedOutput: row.processed_file_path !== null,
    id: row.id,
    datasetId: row.dataset_id,
    version: row.version,
    status: row.status,
    validationStatus: row.validation_status,
    sourceVersionId: row.source_version_id,
    originalFilename: row.original_filename,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    metric: metricConfigurationSchema.parse(row.metric),
    processing: processingOptionsSchema.parse(row.processing),
    rowCount: row.row_count,
    entityCount: row.entity_count,
    periodRange:
      row.period_start !== null && row.period_end !== null
        ? { start: row.period_start, end: row.period_end }
        : null,
    yearRange:
      row.start_year !== null && row.end_year !== null
        ? { startYear: row.start_year, endYear: row.end_year }
        : null,
    errorCount: row.error_count,
    warningCount: row.warning_count,
    summary: row.summary === null ? null : processingSummarySchema.parse(row.summary),
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
  };
}

// ─── Datasets ────────────────────────────────────────────────────────────────────────────────

export interface NewDataset {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topicId: string | null;
  createdBy: string | null;
  unit: string | null;
  metric: MetricConfiguration;
  processing: ProcessingOptions;
}

export async function insertDataset(db: Queryable, input: NewDataset): Promise<Dataset> {
  await db.query(
    `INSERT INTO datasets (id, slug, title, description, unit, metric, processing, topic_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.slug,
      input.title,
      input.description,
      input.unit,
      JSON.stringify(input.metric),
      JSON.stringify(input.processing),
      input.topicId,
      input.createdBy,
    ],
  );
  const created = await getDataset(db, input.id);
  if (!created) throw new Error('Inserted dataset not found');
  return created;
}

export async function getDataset(db: Queryable, id: string): Promise<Dataset | null> {
  const { rows } = await db.query<DatasetRow>(
    `SELECT ${DATASET_COLUMNS} FROM datasets d WHERE d.id = $1`,
    [id],
  );
  return rows[0] ? toDataset(rows[0]) : null;
}

export async function listDatasets(db: Queryable): Promise<DatasetListItem[]> {
  const { rows } = await db.query<DatasetRow & { version_count: number }>(
    `SELECT ${DATASET_COLUMNS},
            (SELECT count(*)::int FROM dataset_versions v WHERE v.dataset_id = d.id) AS version_count
       FROM datasets d
      ORDER BY d.updated_at DESC, d.title`,
  );
  const latestIds = rows.map((row) => row.latest_version_id).filter((id) => id !== null);
  const latest = new Map(
    (await getVersionsByIds(db, latestIds)).map((version) => [version.id, version]),
  );
  return rows.map((row) => ({
    ...toDataset(row),
    versionCount: row.version_count,
    latestVersion: (() => {
      const record = row.latest_version_id ? latest.get(row.latest_version_id) : undefined;
      return record ? publicVersion(record) : null;
    })(),
  }));
}

// ─── Versions ────────────────────────────────────────────────────────────────────────────────

export interface NewVersion {
  id: string;
  datasetId: string;
  sourceVersionId: string | null;
  createdBy: string | null;
  originalFilename: string;
  sourceKey: string;
  sizeBytes: number;
  checksumSha256: string;
  metric: MetricConfiguration;
  processing: ProcessingOptions;
}

/**
 * Creates the next version of a dataset atomically. The dataset row is locked so concurrent
 * uploads get consecutive numbers; UNIQUE (dataset_id, version) is the backstop.
 * Returns null when the dataset does not exist.
 */
export async function createVersion(
  client: pg.PoolClient,
  input: NewVersion,
): Promise<DatasetVersionRecord | null> {
  const locked = await client.query('SELECT id FROM datasets WHERE id = $1 FOR UPDATE', [
    input.datasetId,
  ]);
  if (locked.rowCount === 0) return null;
  const { rows } = await client.query<VersionRow>(
    `INSERT INTO dataset_versions (
       id, dataset_id, version, status, validation_status, source_version_id, original_filename,
       source_file_path, size_bytes, checksum_sha256, metric, processing, created_by)
     VALUES (
       $1, $2,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM dataset_versions WHERE dataset_id = $2),
       'processing', 'pending', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.id,
      input.datasetId,
      input.sourceVersionId,
      input.originalFilename,
      input.sourceKey,
      input.sizeBytes,
      input.checksumSha256,
      JSON.stringify(input.metric),
      JSON.stringify(input.processing),
      input.createdBy,
    ],
  );
  return toVersion(rows[0]!);
}

/** A version by id alone; `lock` takes FOR SHARE (inside a transaction) so it cannot change. */
export async function getVersionById(
  db: Queryable,
  versionId: string,
  lock = false,
): Promise<DatasetVersionRecord | null> {
  const { rows } = await db.query<VersionRow>(
    `SELECT * FROM dataset_versions WHERE id = $1${lock ? ' FOR SHARE' : ''}`,
    [versionId],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function getVersion(
  db: Queryable,
  datasetId: string,
  versionId: string,
): Promise<DatasetVersionRecord | null> {
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM dataset_versions WHERE dataset_id = $1 AND id = $2',
    [datasetId, versionId],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

async function getVersionsByIds(db: Queryable, ids: string[]): Promise<DatasetVersionRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM dataset_versions WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return rows.map(toVersion);
}

export async function listVersions(
  db: Queryable,
  datasetId: string,
): Promise<DatasetVersionRecord[]> {
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM dataset_versions WHERE dataset_id = $1 ORDER BY version DESC',
    [datasetId],
  );
  return rows.map(toVersion);
}

export async function latestUpload(
  db: Queryable,
  datasetId: string,
): Promise<DatasetVersionRecord | null> {
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM dataset_versions WHERE dataset_id = $1 ORDER BY version DESC LIMIT 1',
    [datasetId],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export interface VersionOutcome {
  status: Extract<DatasetVersionStatus, 'ready' | 'failed'>;
  validationStatus: ValidationStatus;
  normalizedKey: string | null;
  reportKey: string | null;
  summary: ProcessingSummary | null;
  periodRange: { start: string; end: string } | null;
  yearRange: { startYear: number; endYear: number } | null;
  errorMessage: string | null;
}

export async function finishVersion(
  db: Queryable,
  versionId: string,
  outcome: VersionOutcome,
): Promise<DatasetVersionRecord> {
  const { rows } = await db.query<VersionRow>(
    `UPDATE dataset_versions SET
       status = $2, validation_status = $3, processed_file_path = $4, report_file_path = $5,
       summary = $6, row_count = $7, entity_count = $8, error_count = $9, warning_count = $10,
       period_start = $11, period_end = $12, start_year = $13, end_year = $14,
       error_message = $15, processed_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      versionId,
      outcome.status,
      outcome.validationStatus,
      outcome.normalizedKey,
      outcome.reportKey,
      outcome.summary === null ? null : JSON.stringify(outcome.summary),
      outcome.summary?.rowCount ?? null,
      outcome.summary ? outcome.summary.entityCount : null,
      outcome.summary?.errorCount ?? null,
      outcome.summary?.warningCount ?? null,
      outcome.periodRange?.start ?? null,
      outcome.periodRange?.end ?? null,
      outcome.yearRange?.startYear ?? null,
      outcome.yearRange?.endYear ?? null,
      outcome.errorMessage,
    ],
  );
  return toVersion(rows[0]!);
}

/**
 * Marks versions left in `processing` by a crashed or restarted API as failed. Only versions
 * older than `olderThanMs` are touched, so another instance's in-flight import is left alone.
 */
export async function failInterruptedVersions(db: Queryable, olderThanMs: number): Promise<number> {
  const result = await db.query(
    `UPDATE dataset_versions
        SET status = 'failed', processed_at = now(),
            error_message = 'Processing was interrupted (the API stopped); reprocess this version'
      WHERE status = 'processing' AND created_at < now() - make_interval(secs => $1::float8 / 1000)`,
    [olderThanMs],
  );
  return result.rowCount ?? 0;
}

// ─── Imported data ───────────────────────────────────────────────────────────────────────────

/** Inserts sources that do not exist yet (keyed by CSV source_id). Returns key → id. */
export async function upsertSources(
  client: pg.PoolClient,
  datasetId: string,
  sources: { id: string; key: string; url: string | null }[],
): Promise<Map<string, string>> {
  if (sources.length === 0) return new Map();
  const { rows } = await client.query<{ id: string; key: string }>(
    `INSERT INTO data_sources (id, key, name, url)
     SELECT * FROM unnest($1::uuid[], $2::text[], $2::text[], $3::text[])
     ON CONFLICT (key) DO UPDATE
       SET url = COALESCE(data_sources.url, EXCLUDED.url), updated_at = now()
     RETURNING id, key`,
    [sources.map((s) => s.id), sources.map((s) => s.key), sources.map((s) => s.url)],
  );
  const ids = new Map(rows.map((row) => [row.key, row.id]));
  await client.query(
    `INSERT INTO dataset_sources (dataset_id, data_source_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [datasetId, [...ids.values()]],
  );
  return ids;
}

export interface NewEntity {
  id: string;
  key: string;
  name: string;
  type: DatasetEntityType;
  category: string | null;
  imageUrl: string | null;
}

export async function insertEntities(
  client: pg.PoolClient,
  versionId: string,
  entities: NewEntity[],
): Promise<void> {
  if (entities.length === 0) return;
  await client.query(
    `INSERT INTO data_entities (id, dataset_version_id, key, name, type, category, image_url)
     SELECT id, $1, key, name, type, category, image_url
       FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
         AS t(id, key, name, type, category, image_url)`,
    [
      versionId,
      entities.map((e) => e.id),
      entities.map((e) => e.key),
      entities.map((e) => e.name),
      entities.map((e) => e.type),
      entities.map((e) => e.category),
      entities.map((e) => e.imageUrl),
    ],
  );
}

export interface NewDataPoint {
  entityId: string;
  period: string;
  periodPosition: number;
  year: number;
  value: number | null;
  dataSourceId: string;
  sourceRow: number;
  notes: string | null;
}

const DATA_POINT_BATCH = 5_000;

export async function insertDataPoints(
  client: pg.PoolClient,
  versionId: string,
  points: NewDataPoint[],
): Promise<void> {
  for (let start = 0; start < points.length; start += DATA_POINT_BATCH) {
    const batch = points.slice(start, start + DATA_POINT_BATCH);
    await client.query(
      `INSERT INTO data_points (
         dataset_version_id, entity_id, period, period_position, year, value, data_source_id,
         source_row, notes)
       SELECT $1, * FROM unnest(
         $2::uuid[], $3::text[], $4::int[], $5::int[], $6::float8[], $7::uuid[], $8::int[],
         $9::text[])`,
      [
        versionId,
        batch.map((p) => p.entityId),
        batch.map((p) => p.period),
        batch.map((p) => p.periodPosition),
        batch.map((p) => p.year),
        batch.map((p) => p.value),
        batch.map((p) => p.dataSourceId),
        batch.map((p) => p.sourceRow),
        batch.map((p) => p.notes),
      ],
    );
  }
}

export async function setLatestVersion(
  client: pg.PoolClient,
  datasetId: string,
  versionId: string,
  unit: string,
): Promise<void> {
  await client.query(
    `UPDATE datasets SET latest_version_id = $2, unit = $3, updated_at = now() WHERE id = $1`,
    [datasetId, versionId, unit],
  );
}

export async function countEntities(db: Queryable, versionId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM data_entities WHERE dataset_version_id = $1',
    [versionId],
  );
  return rows[0]?.count ?? 0;
}

export async function listObservations(
  db: Queryable,
  versionId: string,
  offset: number,
  limit: number,
  /** Only entities whose key or name contains this text (case-insensitive). */
  entity?: string,
): Promise<Page<PreviewObservation>> {
  // ILIKE wildcards in the search text are matched literally.
  const pattern = entity ? `%${entity.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const [{ rows }, total] = await Promise.all([
    db.query<{
      source_row: number;
      key: string;
      name: string;
      period: string;
      value: number | null;
      source_key: string;
      notes: string | null;
    }>(
      `SELECT p.source_row, e.key, e.name, p.period, p.value, s.key AS source_key, p.notes
         FROM data_points p
         JOIN data_entities e ON e.id = p.entity_id
         JOIN data_sources s ON s.id = p.data_source_id
        WHERE p.dataset_version_id = $1
          AND ($4::text IS NULL OR e.key ILIKE $4 OR e.name ILIKE $4)
        ORDER BY p.source_row
        OFFSET $2 LIMIT $3`,
      [versionId, offset, limit, pattern],
    ),
    db.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM data_points p JOIN data_entities e ON e.id = p.entity_id
        WHERE p.dataset_version_id = $1
          AND ($2::text IS NULL OR e.key ILIKE $2 OR e.name ILIKE $2)`,
      [versionId, pattern],
    ),
  ]);
  return {
    total: total.rows[0]?.count ?? 0,
    offset,
    limit,
    items: rows.map((row) => ({
      row: row.source_row,
      entityId: row.key,
      entityName: row.name,
      period: row.period,
      value: row.value,
      sourceId: row.source_key,
      notes: row.notes,
    })),
  };
}
