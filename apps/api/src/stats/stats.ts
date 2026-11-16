import { lstat, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';

import type { DashboardStats } from '@statsopedia/shared-types';
import type { LocalStorage } from '@statsopedia/utils/node';
import { Router } from 'express';
import type pg from 'pg';

/** Top-level storage areas reported on the dashboard. */
export const STORAGE_AREAS = [
  'datasets',
  'processed',
  'assets',
  'renders',
  'thumbnails',
  'logs',
  'temp',
] as const;

/** Storage usage is walked at most this often (it touches every file). */
const STORAGE_CACHE_MS = 60_000;

/** Total size and file count under a directory. Symlinks are not followed. */
export async function directoryUsage(directory: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue; // missing or unreadable: counts as empty
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) {
        try {
          bytes += (await lstat(full)).size;
          files += 1;
        } catch {
          // removed meanwhile
        }
      }
    }
  }
  return { bytes, files };
}

export function createStatsRouter({
  pool,
  storage,
}: {
  pool: pg.Pool;
  storage: LocalStorage;
}): Router {
  let cached: { at: number; value: Promise<DashboardStats['storage']> } | undefined;

  const storageUsage = async (): Promise<DashboardStats['storage']> => {
    const areas = await Promise.all(
      STORAGE_AREAS.map(async (area) => ({
        area,
        ...(await directoryUsage(storage.resolve(area))),
      })),
    );
    let volumeBytes: number | null = null;
    let freeBytes: number | null = null;
    try {
      const volume = await statfs(storage.root);
      volumeBytes = volume.blocks * volume.bsize;
      freeBytes = volume.bavail * volume.bsize;
    } catch {
      // Not reported on this platform.
    }
    return {
      areas,
      usedBytes: areas.reduce((sum, area) => sum + area.bytes, 0),
      volumeBytes,
      freeBytes,
      measuredAt: new Date().toISOString(),
    };
  };

  const router = Router();
  router.get('/', async (_req, res) => {
    if (!cached || Date.now() - cached.at > STORAGE_CACHE_MS) {
      cached = { at: Date.now(), value: storageUsage() };
    }
    const [{ rows: counts }, { rows: jobs }, usage] = await Promise.all([
      pool.query<{ datasets: number; projects: number; outputs: number }>(
        `SELECT (SELECT count(*)::int FROM datasets) AS datasets,
                (SELECT count(*)::int FROM video_projects WHERE status <> 'archived') AS projects,
                (SELECT count(*)::int FROM video_outputs) AS outputs`,
      ),
      pool.query<{ status: string; count: number }>(
        'SELECT status, count(*)::int AS count FROM render_jobs GROUP BY status',
      ),
      cached.value,
    ]);
    const byStatus = new Map(jobs.map((row) => [row.status, row.count]));
    const body: DashboardStats = {
      datasets: counts[0]!.datasets,
      projects: counts[0]!.projects,
      renders: {
        completed: byStatus.get('completed') ?? 0,
        failed: byStatus.get('failed') ?? 0,
        cancelled: byStatus.get('cancelled') ?? 0,
        pending: ['pending', 'validating', 'preparing', 'rendering', 'post_processing'].reduce(
          (sum, status) => sum + (byStatus.get(status) ?? 0),
          0,
        ),
      },
      outputs: counts[0]!.outputs,
      storage: usage,
    };
    res.json(body);
  });
  return router;
}
