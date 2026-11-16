import type { RenderJobResult } from '@statsopedia/shared-types';
import type { Logger } from '@statsopedia/utils/node';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { ProcessableJob } from './processor.js';

export type RenderWorker = Worker<unknown, RenderJobResult>;

export interface RenderWorkerOptions {
  queueName: string;
  /** Must be created with `maxRetriesPerRequest: null` (BullMQ requirement for workers). */
  connection: Redis;
  processor: (
    job: ProcessableJob,
    token?: string,
    signal?: AbortSignal,
  ) => Promise<RenderJobResult>;
  concurrency: number;
  logger: Logger;
  /** BullMQ key prefix (tests isolate their queues with one). */
  prefix?: string | undefined;
  /**
   * How long a job's lock lasts without renewal. A crashed worker stops renewing, and the job
   * is recovered as stalled and retried by another worker after about this long.
   */
  lockDurationMs?: number;
  stalledIntervalMs?: number;
}

export function createRenderWorker({
  queueName,
  connection,
  processor,
  concurrency,
  logger,
  prefix,
  lockDurationMs = 60_000,
  stalledIntervalMs = 30_000,
}: RenderWorkerOptions): RenderWorker {
  const worker: RenderWorker = new Worker<unknown, RenderJobResult>(
    queueName,
    // BullMQ passes a cancellation signal only to processors declaring all three parameters
    // (it checks `function.length`), so keep them explicit.
    (job, token, signal) => processor(job, token, signal),
    {
      connection,
      concurrency,
      ...(prefix ? { prefix } : {}),
      // Renders run for minutes; the lock is renewed automatically while the job is active.
      lockDuration: lockDurationMs,
      stalledInterval: stalledIntervalMs,
      // A job whose worker crashed is recovered once; a second crash fails it (WORKER_CRASHED).
      maxStalledCount: 1,
    },
  );

  // BullMQ emits an error for every reconnect attempt on each of its connections; log each
  // distinct error once instead of flooding the logs while Redis is down.
  let lastErrorMessage: string | undefined;

  // The Worker emits 'ready' only once, after its first connection, so reset on the shared
  // connection's 'ready' instead: ioredis emits that after every reconnect.
  connection.on('ready', () => {
    lastErrorMessage = undefined;
  });
  worker.on('ready', () => {
    logger.info({ queue: queueName, concurrency }, 'Render worker waiting for jobs');
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { err: error, queueJobId: job?.id, attemptsMade: job?.attemptsMade },
      'Render job failed',
    );
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ queueJobId: jobId }, 'Render job stalled and will be retried');
  });
  worker.on('error', (error) => {
    if (error.message === lastErrorMessage) return;
    lastErrorMessage = error.message;
    logger.error({ err: error }, 'Render worker error (repeats suppressed until reconnected)');
  });

  return worker;
}
