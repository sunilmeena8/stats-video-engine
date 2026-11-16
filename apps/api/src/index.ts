import { createServer } from 'node:http';

import {
  ConfigError,
  LocalStorage,
  createLogger,
  ensureStorageDirectories,
  loadEnvFile,
  readPackageVersion,
} from '@statsopedia/utils/node';
import pg from 'pg';

import { createApp } from './app.js';
import { createDataProcessorClient } from './datasets/processor-client.js';
import { failInterruptedVersions } from './datasets/repository.js';
import { buildApiServices } from './services.js';
import { loadConfig, type ApiConfig } from './config.js';
import { createPostgresCheck, createRedisCheck } from './health.js';
import { closeRedisConnection, createRedisConnection } from './redis.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readConfig(): ApiConfig {
  loadEnvFile();
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`[api] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const version = readPackageVersion(new URL('../package.json', import.meta.url));
  const logger = createLogger({ service: 'api', level: config.LOG_LEVEL, version });

  await ensureStorageDirectories(config.STORAGE_ROOT);

  // Dependencies connect lazily/in the background: the API starts (and reports itself not
  // ready) even when PostgreSQL or Redis are down.
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: config.HEALTH_CHECK_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (error) => logger.error({ err: error }, 'Idle PostgreSQL client error'));

  // Fail fast instead of queueing commands while Redis is unreachable.
  const redis = createRedisConnection(config.REDIS_URL, logger, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  const storage = new LocalStorage(config.STORAGE_ROOT);
  const services = buildApiServices({
    pool,
    redis,
    storage,
    processor: createDataProcessorClient({
      baseUrl: config.DATA_PROCESSOR_URL,
      timeoutMs: config.DATA_PROCESSOR_TIMEOUT_MS,
    }),
    logger,
    limits: {
      csvUploadBytes: config.MAX_UPLOAD_BYTES,
      mediaUploadBytes: config.MAX_MEDIA_BYTES,
      requestsPerMinute: config.RATE_LIMIT_PER_MINUTE,
      uploadsPerHour: config.UPLOADS_PER_HOUR,
    },
    sessionTtlMs: config.SESSION_TTL_HOURS * 3_600_000,
    monitorEnabled: config.JOB_MONITOR_ENABLED,
  });

  // Versions left in `processing` by a previous crash will never finish: mark them failed.
  // Best effort, since the database may be down at start-up.
  failInterruptedVersions(pool, config.DATA_PROCESSOR_TIMEOUT_MS * 2)
    .then((count) => {
      if (count > 0) logger.warn({ count }, 'Marked interrupted dataset versions as failed');
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, 'Could not check for interrupted dataset versions');
    });

  const app = createApp({
    logger,
    service: { name: 'api', version, startedAt: new Date() },
    readinessChecks: [createPostgresCheck(pool), createRedisCheck(redis)],
    healthCheckTimeoutMs: config.HEALTH_CHECK_TIMEOUT_MS,
    api: services,
  });

  const server = createServer(app);
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server error');
    process.exit(1);
  });
  server.listen(config.API_PORT, config.API_HOST, () => {
    logger.info(
      { host: config.API_HOST, port: config.API_PORT, storageRoot: config.STORAGE_ROOT },
      'API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => {
      logger.error('Shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Open SSE streams would keep server.close() waiting forever.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await services
      .close()
      .catch((error: unknown) => logger.warn({ err: error }, 'Error closing services'));
    const results = await Promise.allSettled([pool.end(), closeRedisConnection(redis)]);
    for (const result of results) {
      if (result.status === 'rejected')
        logger.warn({ err: result.reason }, 'Error during shutdown');
    }
    logger.info('Shutdown complete');
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  process.stderr.write(`[api] Fatal start-up error: ${String(error)}\n`);
  process.exit(1);
});
