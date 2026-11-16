import { QUEUE_NAMES, REDIS_CHANNELS, RENDER_CANCEL_KEY_PREFIX } from '@statsopedia/shared-types';
import type { LocalStorage, Logger } from '@statsopedia/utils/node';
import type { Redis } from 'ioredis';
import type pg from 'pg';

import { startAssetServer } from './asset-server.js';
import type { MediaTools } from './media-tools.js';
import { USER_CANCEL_REASON, createRenderProcessor, type ProcessorOptions } from './processor.js';
import type { VideoRenderer } from './renderer.js';
import { createRenderWorker, type RenderWorker } from './worker.js';

export interface WorkerRuntimeOptions {
  /** Must be created with `maxRetriesPerRequest: null` (BullMQ requirement for workers). */
  connection: Redis;
  pool: pg.Pool;
  storage: LocalStorage;
  renderer: VideoRenderer;
  media: MediaTools;
  logger: Logger;
  workerId: string;
  /** Concurrent jobs per queue: final renders start at one. */
  concurrency: { final: number; preview: number };
  /** Remotion frame concurrency (browser tabs), or null for Remotion's default. */
  remotionConcurrency: number | null;
  timeoutMs: { preview: number; final: number };
  prefix?: string | undefined;
  lockDurationMs?: number;
  stalledIntervalMs?: number;
  /** Replaces the pipeline (tests). */
  run?: ProcessorOptions['run'];
}

export interface WorkerRuntime {
  workers: RenderWorker[];
  /**
   * Graceful stop: active renders are cancelled and their jobs returned to the queue. With
   * `force`, workers stop without touching their jobs (they are recovered as stalled).
   */
  close(options?: { force?: boolean }): Promise<void>;
}

/** Starts both render queues' workers, the local asset server and cancellation listening. */
export async function startWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntime> {
  const { connection, storage, logger } = options;
  const assets = await startAssetServer(storage, logger);
  const processor = createRenderProcessor({
    pool: options.pool,
    storage,
    renderer: options.renderer,
    media: options.media,
    logger,
    workerId: options.workerId,
    assetBaseUrl: assets.baseUrl,
    concurrency: options.remotionConcurrency,
    timeoutMs: options.timeoutMs,
    isCancelled: async (renderJobId) =>
      (await connection.exists(`${RENDER_CANCEL_KEY_PREFIX}${renderJobId}`)) === 1,
    ...(options.run ? { run: options.run } : {}),
  });
  const common = {
    connection,
    processor,
    logger,
    prefix: options.prefix,
    ...(options.lockDurationMs ? { lockDurationMs: options.lockDurationMs } : {}),
    ...(options.stalledIntervalMs ? { stalledIntervalMs: options.stalledIntervalMs } : {}),
  };
  // Separate queues, so a long final render never delays a quick preview.
  const workers = [
    createRenderWorker({
      ...common,
      queueName: QUEUE_NAMES.renderFinal,
      concurrency: options.concurrency.final,
    }),
    createRenderWorker({
      ...common,
      queueName: QUEUE_NAMES.renderPreview,
      concurrency: options.concurrency.preview,
    }),
  ];

  // Cancellation requests arrive over pub/sub: BullMQ can only abort an active job from the
  // process that runs it. Workers that do not hold the job ignore the message.
  const subscriber = connection.duplicate();
  subscriber.on('error', () => undefined); // reported by the main connection already
  await subscriber.subscribe(REDIS_CHANNELS.renderCancel).catch((error: unknown) => {
    logger.warn(
      { err: error },
      'Could not subscribe to cancellations yet; will retry on reconnect',
    );
  });
  subscriber.on('message', (channel, renderJobId) => {
    if (channel !== REDIS_CHANNELS.renderCancel) return;
    const cancelled = workers.some((worker) => worker.cancelJob(renderJobId, USER_CANCEL_REASON));
    if (cancelled) logger.info({ renderJobId }, 'Cancelling render on request');
  });

  return {
    workers,
    async close({ force = false } = {}) {
      if (!force) for (const worker of workers) worker.cancelAllJobs('worker-shutdown');
      await Promise.all(workers.map((worker) => worker.close(force)));
      subscriber.disconnect();
      await assets.close();
    },
  };
}
