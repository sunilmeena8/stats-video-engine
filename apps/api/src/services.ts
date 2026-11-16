import { RENDER_CANCEL_KEY_PREFIX } from '@statsopedia/shared-types';
import type { Logger, LocalStorage } from '@statsopedia/utils/node';
import type { Redis } from 'ioredis';
import type pg from 'pg';

import type { ApiServices } from './app.js';
import { AuthService } from './auth/service.js';
import type { DataProcessorClient } from './datasets/processor-client.js';
import { DatasetService } from './datasets/service.js';
import { createAudioAnalyzer, type AudioAnalyzer } from './media/audio.js';
import { ProjectService } from './projects/projects.js';
import { RenderMonitor } from './render/monitor.js';
import { RenderOrchestrator, payloadFor } from './render/orchestrator.js';
import { createRenderQueues, type RenderQueues } from './render/queues.js';

export interface BuildOptions {
  pool: pg.Pool;
  /** Main Redis connection (producers, publish). */
  redis: Redis;
  storage: LocalStorage;
  processor: DataProcessorClient;
  logger: Logger;
  limits: ApiServices['limits'];
  sessionTtlMs: number;
  monitorEnabled: boolean;
  /** BullMQ key prefix (tests use a unique one). */
  queuePrefix?: string | undefined;
  reconcileIntervalMs?: number | undefined;
  /** Overrides retry backoff (tests). */
  retryDelayMs?: number | undefined;
  /** Defaults to FFmpeg from Remotion's compositor package. */
  audio?: AudioAnalyzer | undefined;
}

/** Composition root of the API, shared by the server entry point and integration tests. */
export function buildApiServices(options: BuildOptions): ApiServices & {
  queues: RenderQueues;
  close: () => Promise<void>;
} {
  const { pool, redis, storage, logger } = options;
  const queues = createRenderQueues(redis, {
    ...(options.queuePrefix ? { prefix: options.queuePrefix } : {}),
    ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
  });
  const datasets = new DatasetService({ pool, storage, processor: options.processor, logger });
  const projects = new ProjectService(pool, datasets, storage);
  const monitor = new RenderMonitor({
    pool,
    queues,
    // QueueEvents blocks on its connection, so it needs its own, which may queue while Redis
    // is briefly down.
    eventConnection: () =>
      redis.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: true }),
    logger: logger.child({ component: 'render-monitor' }),
    prefix: options.queuePrefix,
    reconcileIntervalMs: options.reconcileIntervalMs,
    reconcile: options.monitorEnabled,
  });
  const orchestrator = new RenderOrchestrator({
    pool,
    queues,
    projects,
    publish: (channel, message) => redis.publish(channel, message),
    flagCancelled: (jobId) => redis.set(`${RENDER_CANCEL_KEY_PREFIX}${jobId}`, '1', 'EX', 86_400),
    logger: logger.child({ component: 'render-orchestrator' }),
  });
  monitor.setRequeue((job) => queues.enqueue(payloadFor(job)));
  // Notifications feed Server-Sent Events in every instance; reconciliation runs in one.
  const started = monitor.start().catch((error: unknown) => {
    logger.error({ err: error }, 'Render monitor failed to start');
  });

  return {
    pool,
    storage,
    auth: new AuthService(pool, options.sessionTtlMs, logger.child({ component: 'auth' })),
    datasets,
    projects,
    orchestrator,
    monitor,
    audio: options.audio ?? createAudioAnalyzer(),
    limits: options.limits,
    queues,
    async close() {
      await started;
      await monitor.stop();
      await queues.close();
    },
  };
}
