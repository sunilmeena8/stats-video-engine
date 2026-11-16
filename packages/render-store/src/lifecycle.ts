import {
  canTransitionRenderJob,
  isTerminalRenderStatus,
  type MediaAssetType,
  type RenderErrorCode,
  type RenderJobEvent,
  type RenderJobStatus,
} from '@statsopedia/shared-types';

import { withTransaction, type Queryable, type TransactionPool } from './db.js';
import { lockProject, refreshProjectStatus } from './projects.js';
import {
  getJob,
  getManifest,
  getRequest,
  insertEvent,
  insertOutput,
  type JobRecord,
  type ManifestRecord,
  type NewOutput,
  type RequestRecord,
} from './records.js';

export interface LogEntry {
  level: RenderJobEvent['level'];
  message: string;
}

/** A change to one job. `status` may equal the current one (progress within a stage). */
export interface JobChange {
  status: RenderJobStatus;
  percent?: number;
  message?: string | null;
  attempts?: number;
  errorCode?: RenderErrorCode | null;
  errorMessage?: string | null;
  workerId?: string | null;
  /** Render log entry written in the same transaction. */
  log?: LogEntry | null;
}

export interface TransitionResult {
  /** False when the change was refused (the job finished or the transition is not allowed). */
  applied: boolean;
  job: JobRecord;
  event: RenderJobEvent | null;
}

async function applyChange(
  client: Queryable,
  job: JobRecord,
  change: JobChange,
): Promise<JobRecord> {
  const sets: string[] = ['updated_at = now()', 'status = $2'];
  const params: unknown[] = [job.id, change.status];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  const percent = change.status === 'completed' ? 100 : change.percent;
  if (percent !== undefined) set('percent', Math.min(100, Math.max(0, percent)));
  if (change.message !== undefined) set('message', change.message?.slice(0, 500) ?? null);
  if (change.attempts !== undefined) set('attempts', change.attempts);
  if (change.errorCode !== undefined) set('error_code', change.errorCode);
  if (change.errorMessage !== undefined)
    set('error_message', change.errorMessage?.slice(0, 2_000) ?? null);
  if (change.workerId !== undefined) set('worker_id', change.workerId);
  if (change.status !== 'pending') sets.push('started_at = COALESCE(started_at, now())');
  if (isTerminalRenderStatus(change.status)) sets.push('finished_at = now()');
  await client.query(`UPDATE render_jobs SET ${sets.join(', ')} WHERE id = $1`, params);
  return (await getJob(client, job.id))!;
}

async function inTransition<T extends { job: JobRecord }>(
  pool: TransactionPool,
  jobId: string,
  work: (client: Queryable, job: JobRecord) => Promise<T | null>,
): Promise<T | { applied: false; job: JobRecord; event: null } | null> {
  const known = await getJob(pool as unknown as Queryable, jobId);
  if (!known) return null;
  return withTransaction(pool, async (client) => {
    // Lock order: project, then job (see lockProject).
    await lockProject(client, known.projectId);
    const job = await getJob(client, jobId, true);
    if (!job) return null;
    return (await work(client, job)) ?? { applied: false as const, job, event: null };
  });
}

/**
 * Moves a job to `change.status` (or records progress within its stage) in one transaction,
 * with an optional log entry. Refused, not thrown, when the transition is not allowed: a late
 * progress report for a cancelled job is simply ignored. PostgreSQL enforces the same rule.
 */
export async function transitionJob(
  pool: TransactionPool,
  jobId: string,
  change: JobChange,
): Promise<TransitionResult | null> {
  return inTransition(pool, jobId, async (client, job) => {
    if (!canTransitionRenderJob(job.status, change.status)) return null;
    if (change.status === 'completed') {
      throw new Error('Use completeJob to complete a job (it stores the output)');
    }
    const updated = await applyChange(client, job, change);
    const event = change.log
      ? await insertEvent(client, {
          renderJobId: job.id,
          level: change.log.level,
          status: updated.status,
          percent: updated.percent,
          message: change.log.message,
        })
      : null;
    if (updated.status !== job.status && job.kind === 'final') {
      await refreshProjectStatus(client, job.projectId);
    }
    return { applied: true, job: updated, event };
  });
}

/**
 * Stores a finished video and completes its job atomically: the output row and the
 * `completed` status become visible together, or neither does.
 */
export async function completeJob(
  pool: TransactionPool,
  jobId: string,
  { output, attempts, log }: { output: NewOutput; attempts: number; log: LogEntry },
): Promise<TransitionResult | null> {
  return inTransition(pool, jobId, async (client, job) => {
    if (!canTransitionRenderJob(job.status, 'completed')) return null;
    await insertOutput(client, output);
    const updated = await applyChange(client, job, {
      status: 'completed',
      message: log.message,
      attempts,
      errorCode: null,
      errorMessage: null,
    });
    const event = await insertEvent(client, {
      renderJobId: job.id,
      level: log.level,
      status: 'completed',
      percent: 100,
      message: log.message,
    });
    if (job.kind === 'final') await refreshProjectStatus(client, job.projectId);
    return { applied: true, job: updated, event };
  });
}

/** Records that a user asked to cancel a job (once); the status change comes separately. */
export async function requestCancellation(
  pool: TransactionPool,
  jobId: string,
): Promise<TransitionResult | null> {
  return inTransition(pool, jobId, async (client, job) => {
    if (isTerminalRenderStatus(job.status) || job.cancelRequestedAt) return null;
    await client.query(
      'UPDATE render_jobs SET cancel_requested_at = now(), updated_at = now() WHERE id = $1',
      [job.id],
    );
    const event = await insertEvent(client, {
      renderJobId: job.id,
      level: 'warn',
      status: job.status,
      percent: job.percent,
      message: 'Cancellation requested',
    });
    return { applied: true, job: (await getJob(client, job.id))!, event };
  });
}

/**
 * Adds a render log entry without changing the job, e.g. "worker stopped responding". Never
 * changes status, so it cannot race a worker that is already running the next attempt.
 */
export async function logJobEvent(
  pool: TransactionPool,
  jobId: string,
  entry: LogEntry,
): Promise<TransitionResult | null> {
  return inTransition(pool, jobId, async (client, job) => {
    if (isTerminalRenderStatus(job.status)) return null;
    const event = await insertEvent(client, {
      renderJobId: job.id,
      level: entry.level,
      status: job.status,
      percent: job.percent,
      message: entry.message,
    });
    return { applied: true, job, event };
  });
}

// ─── What the worker loads for a job ─────────────────────────────────────────────────────────

export interface DatasetVersionSnapshot {
  id: string;
  datasetId: string;
  version: number;
  status: string;
  /** Storage key of the normalized (animation-ready) JSON, or null if processing failed. */
  normalizedKey: string | null;
}

export interface MediaSnapshot {
  id: string;
  type: MediaAssetType;
  storageKey: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface RenderContext {
  job: JobRecord;
  request: RequestRecord;
  manifest: ManifestRecord;
  project: { id: string; status: string; revision: number };
  datasetVersion: DatasetVersionSnapshot | null;
  music: MediaSnapshot | null;
}

/** Loads everything a render needs, by job id. Null when the job does not exist. */
export async function loadRenderContext(
  db: Queryable,
  jobId: string,
): Promise<RenderContext | null> {
  const job = await getJob(db, jobId);
  if (!job) return null;
  const [request, manifest, projectRows] = await Promise.all([
    getRequest(db, job.requestId),
    getManifest(db, job.manifestId),
    db.query<{ id: string; status: string; revision: number }>(
      'SELECT id, status, revision FROM video_projects WHERE id = $1',
      [job.projectId],
    ),
  ]);
  if (!request || !manifest || !projectRows.rows[0]) return null;
  const { rows: versions } = await db.query<{
    id: string;
    dataset_id: string;
    version: number;
    status: string;
    processed_file_path: string | null;
  }>(
    'SELECT id, dataset_id, version, status, processed_file_path FROM dataset_versions WHERE id = $1',
    [manifest.datasetVersionId],
  );
  const version = versions[0];
  let music: MediaSnapshot | null = null;
  if (manifest.musicAssetId) {
    const { rows } = await db.query<{
      id: string;
      type: MediaAssetType;
      storage_key: string;
      size_bytes: string;
      checksum_sha256: string;
    }>(
      'SELECT id, type, storage_key, size_bytes, checksum_sha256 FROM media_assets WHERE id = $1',
      [manifest.musicAssetId],
    );
    const row = rows[0];
    music = row
      ? {
          id: row.id,
          type: row.type,
          storageKey: row.storage_key,
          sizeBytes: Number(row.size_bytes),
          checksumSha256: row.checksum_sha256,
        }
      : null;
  }
  return {
    job,
    request,
    manifest,
    project: projectRows.rows[0],
    datasetVersion: version
      ? {
          id: version.id,
          datasetId: version.dataset_id,
          version: version.version,
          status: version.status,
          normalizedKey: version.processed_file_path,
        }
      : null,
    music,
  };
}
