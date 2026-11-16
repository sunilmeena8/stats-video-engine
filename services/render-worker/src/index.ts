import { access } from 'node:fs/promises';
import os from 'node:os';

import {
  ConfigError,
  LocalStorage,
  createLogger,
  ensureStorageDirectories,
  loadEnvFile,
  readPackageVersion,
} from '@statsopedia/utils/node';
import pg from 'pg';

import { reapOrphanedBrowsers } from './browsers.js';
import { loadConfig, type WorkerConfig } from './config.js';
import { sweepTempDirectories } from './files.js';
import { createFfmpegTools } from './media-tools.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';
import { createRemotionRenderer } from './renderer.js';
import { startWorkerRuntime } from './runtime.js';

function readConfig(): WorkerConfig {
  loadEnvFile();
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`[render-worker] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const version = readPackageVersion(new URL('../package.json', import.meta.url));
  const logger = createLogger({ service: 'render-worker', level: config.LOG_LEVEL, version });
  const workerId = config.WORKER_ID ?? `${os.hostname()}:${process.pid}`;

  try {
    await access(config.RENDERER_ENTRY_POINT);
  } catch {
    logger.fatal({ entryPoint: config.RENDERER_ENTRY_POINT }, 'RENDERER_ENTRY_POINT not found');
    process.exit(1);
  }
  await ensureStorageDirectories(config.STORAGE_ROOT);
  const storage = new LocalStorage(config.STORAGE_ROOT);
  const swept = await sweepTempDirectories(storage, config.TEMP_RETENTION_HOURS * 3_600_000);
  if (swept) logger.info({ removed: swept }, 'Removed stale render working directories');
  // Browsers left running by a worker that was killed outright (before we open our own).
  await reapOrphanedBrowsers(logger);

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
  pool.on('error', (error) => logger.warn({ err: error }, 'PostgreSQL idle client error'));
  const binariesDirectory = config.FFMPEG_BINARIES_DIR ?? null;
  const renderer = createRemotionRenderer({
    entryPoint: config.RENDERER_ENTRY_POINT,
    logger,
    concurrency: config.REMOTION_CONCURRENCY ?? null,
    frameTimeoutMs: config.FRAME_TIMEOUT_SECONDS * 1_000,
    binariesDirectory,
  });
  // Bundle in the background so the first job starts quickly. A failure here is retried on
  // the first job rather than crashing the worker.
  renderer.warmUp().catch((error: unknown) => {
    logger.error({ err: error }, 'Renderer warm-up failed; will retry on the first job');
  });

  // BullMQ workers require maxRetriesPerRequest: null (blocking commands must not time out).
  const connection = createRedisConnection(config.REDIS_URL, logger, {
    maxRetriesPerRequest: null,
  });
  const runtime = await startWorkerRuntime({
    connection,
    pool,
    storage,
    renderer,
    media: createFfmpegTools({ binariesDirectory }),
    logger,
    workerId,
    concurrency: { final: config.RENDER_CONCURRENCY, preview: config.PREVIEW_CONCURRENCY },
    remotionConcurrency: config.REMOTION_CONCURRENCY ?? null,
    timeoutMs: {
      final: config.RENDER_TIMEOUT_MINUTES * 60_000,
      preview: config.PREVIEW_TIMEOUT_MINUTES * 60_000,
    },
    prefix: config.QUEUE_PREFIX,
    lockDurationMs: config.LOCK_DURATION_SECONDS * 1_000,
    stalledIntervalMs: config.STALLED_INTERVAL_SECONDS * 1_000,
  });

  logger.info(
    {
      workerId,
      storageRoot: config.STORAGE_ROOT,
      concurrency: config.RENDER_CONCURRENCY,
      previewConcurrency: config.PREVIEW_CONCURRENCY,
      remotionConcurrency: config.REMOTION_CONCURRENCY ?? 'auto',
      timeoutMinutes: {
        final: config.RENDER_TIMEOUT_MINUTES,
        preview: config.PREVIEW_TIMEOUT_MINUTES,
      },
    },
    'Render worker started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'Second signal received; exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    // In-flight renders cannot finish: Remotion registers its own SIGTERM/SIGHUP handlers that
    // kill Chrome mid-render (and its SIGINT handler exits the process outright). So cancel them;
    // each goes straight back to the queue (status pending) for the next worker.
    //
    // Returning a job needs Redis. If Redis is unreachable a graceful close hangs forever, so
    // close immediately instead; BullMQ then recovers those jobs as stalled once their lock expires.
    const graceful = connection.status === 'ready';
    logger.info(
      { signal, graceful },
      graceful
        ? 'Shutting down; returning active renders to the queue'
        : 'Shutting down; Redis unavailable, active renders will be recovered as stalled',
    );
    try {
      await runtime.close({ force: !graceful });
      await closeRedisConnection(connection);
      await pool.end();
      logger.info('Shutdown complete');
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', (signal) => void shutdown(signal));
  process.on('SIGTERM', (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  process.stderr.write(`[render-worker] Fatal start-up error: ${String(error)}\n`);
  process.exit(1);
});
