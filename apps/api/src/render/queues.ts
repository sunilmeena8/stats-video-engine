import { renderJobPayloadSchema } from '@statsopedia/shared-schemas';
import { QUEUE_NAMES, type RenderJobPayload, type RenderKind } from '@statsopedia/shared-types';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

/** Attempts per job: transient failures (a crashed browser, a timeout) are retried. */
export const MAX_ATTEMPTS: Record<RenderKind, number> = { final: 3, preview: 2 };

/**
 * Retries for recoverable failures (a crashed browser, a timeout). The worker fails invalid
 * input permanently (UnrecoverableError), so it is never retried.
 */
export const JOB_OPTIONS: Record<RenderKind, JobsOptions> = {
  final: {
    attempts: MAX_ATTEMPTS.final,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
  preview: {
    attempts: MAX_ATTEMPTS.preview,
    backoff: { type: 'fixed', delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
};

export interface RenderQueues {
  forKind(kind: RenderKind): Queue;
  byName(name: string): Queue | undefined;
  all(): Queue[];
  /** Validates the payload, then adds it with jobId = renderJobId (adding twice is a no-op). */
  enqueue(payload: RenderJobPayload): Promise<void>;
  close(): Promise<void>;
}

export function createRenderQueues(
  connection: Redis,
  options: { prefix?: string; retryDelayMs?: number } = {},
): RenderQueues {
  const { retryDelayMs, ...queueOptions } = options;
  const jobOptions = (kind: RenderKind): JobsOptions =>
    retryDelayMs === undefined
      ? JOB_OPTIONS[kind]
      : { ...JOB_OPTIONS[kind], backoff: { type: 'fixed', delay: retryDelayMs } };
  const queues: Record<RenderKind, Queue> = {
    preview: new Queue(QUEUE_NAMES.renderPreview, { connection, ...queueOptions }),
    final: new Queue(QUEUE_NAMES.renderFinal, { connection, ...queueOptions }),
  };
  return {
    forKind: (kind) => queues[kind],
    byName: (name) => Object.values(queues).find((queue) => queue.name === name),
    all: () => Object.values(queues),
    async enqueue(payload) {
      const valid = renderJobPayloadSchema.parse(payload);
      await queues[valid.kind].add('render', valid, {
        ...jobOptions(valid.kind),
        jobId: valid.renderJobId,
      });
    },
    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    },
  };
}
