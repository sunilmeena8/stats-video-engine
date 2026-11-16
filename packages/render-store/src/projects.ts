import type { Queryable } from './db.js';

/**
 * Serializes changes to one project's jobs (FOR UPDATE on the project row, in a transaction).
 *
 * Lock order: always the project row first, then job rows. Every status change goes through
 * `transitionJob`/`completeJob`, which follow it, so concurrent transitions cannot deadlock and
 * the project status computed last sees all of them.
 */
export async function lockProject(db: Queryable, projectId: string): Promise<void> {
  await db.query('SELECT 1 FROM video_projects WHERE id = $1 FOR UPDATE', [projectId]);
}

/** Reserves the next render version of a project (call with the project row locked). */
export async function nextRenderVersion(db: Queryable, projectId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `UPDATE video_projects SET last_render_version = last_render_version + 1
      WHERE id = $1 RETURNING last_render_version AS version`,
    [projectId],
  );
  if (!rows[0]) throw new Error(`Project ${projectId} not found`);
  return rows[0].version;
}

/**
 * Derives a project's status from its final renders: rendering while one is unfinished,
 * failed when the latest (not cancelled) one failed, rendered once one completed, else draft.
 */
export async function refreshProjectStatus(db: Queryable, projectId: string): Promise<void> {
  await db.query(
    `UPDATE video_projects p SET status = CASE
        WHEN p.status = 'archived' THEN 'archived'
        WHEN EXISTS (SELECT 1 FROM render_jobs j WHERE j.project_id = p.id AND j.kind = 'final'
                       AND j.status NOT IN ('completed', 'failed', 'cancelled')) THEN 'rendering'
        WHEN (SELECT j.status FROM render_jobs j WHERE j.project_id = p.id AND j.kind = 'final'
                AND j.status <> 'cancelled' ORDER BY j.created_at DESC LIMIT 1) = 'failed' THEN 'failed'
        WHEN EXISTS (SELECT 1 FROM video_outputs o WHERE o.project_id = p.id AND o.kind = 'final')
          THEN 'rendered'
        ELSE 'draft' END,
      updated_at = now()
     WHERE p.id = $1`,
    [projectId],
  );
}
