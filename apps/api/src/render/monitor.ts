import { EventEmitter } from 'node:events';

import * as store from '@statsopedia/render-store';
import { RENDER_CANCELLED_MESSAGE, isTerminalRenderStatus } from '@statsopedia/shared-types';
import type { Logger } from '@statsopedia/utils/node';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import type pg from 'pg';

import type { RenderQueues } from './queues.js';

/** PostgreSQL channel the render tables NOTIFY on (payload: render job id). */
export const RENDER_CHANGES_CHANNEL = 'render_changes';

/** Re-queues a job that PostgreSQL considers unfinished but Redis no longer has. */
export type Requeue = (job: store.JobRecord) => Promise<void>;

/** A job missing from Redis this long is assumed lost (not just being added). */
const LOST_AFTER_MS = 60_000;

/**
 * Workers record their own progress and results in PostgreSQL. The monitor:
 *
 * - turns PostgreSQL notifications (`render_changes`) into `change` events, which feed the
 *   Server-Sent Event streams of this API instance;
 * - records what no worker could: a worker that crashed (its job fails with WORKER_CRASHED once
 *   BullMQ gives up on it), a cancelled job whose worker is gone, a job Redis lost (re-queued).
 *
 * Reconciliation only moves a job to a final state BullMQ already reached (or logs), so it
 * cannot disturb a worker that is rendering. Run it in one API instance (`JOB_MONITOR_ENABLED`);
 * notifications are listened to everywhere.
 */
export class RenderMonitor extends EventEmitter<{ change: [jobId: string] }> {
  #events: QueueEvents[] = [];
  #timer: NodeJS.Timeout | undefined;
  #requeue: Requeue | undefined;
  #listener: pg.PoolClient | undefined;
  #stopped = true;

  constructor(
    private readonly deps: {
      pool: pg.Pool;
      queues: RenderQueues;
      /** Dedicated blocking connection factory for QueueEvents. */
      eventConnection: () => Redis;
      logger: Logger;
      prefix?: string | undefined;
      reconcileIntervalMs?: number | undefined;
      /** Reconcile with the queue (enable in one API instance). */
      reconcile: boolean;
    },
  ) {
    super();
    this.setMaxListeners(0); // one listener per open SSE stream
  }

  setRequeue(requeue: Requeue) {
    this.#requeue = requeue;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#listen();
    if (!this.deps.reconcile) return;
    for (const queue of this.deps.queues.all()) {
      const events = new QueueEvents(queue.name, {
        connection: this.deps.eventConnection(),
        ...(this.deps.prefix ? { prefix: this.deps.prefix } : {}),
      });
      events.on('error', (error) => this.deps.logger.warn({ err: error }, 'Queue events error'));
      events.on('failed', ({ jobId }) => void this.sync(jobId));
      events.on('removed', ({ jobId }) => void this.sync(jobId));
      events.on('stalled', ({ jobId }) => void this.#stalled(jobId));
      this.#events.push(events);
    }
    void this.reconcile();
    this.#timer = setInterval(() => void this.reconcile(), this.deps.reconcileIntervalMs ?? 30_000);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#timer);
    await Promise.all(this.#events.map((events) => events.close()));
    this.#events = [];
    const listener = this.#listener;
    this.#listener = undefined;
    if (listener) {
      await listener.query(`UNLISTEN ${RENDER_CHANGES_CHANNEL}`).catch(() => undefined);
      listener.release();
    }
  }

  /** Holds one connection with LISTEN, and reconnects if it drops. */
  async #listen(): Promise<void> {
    try {
      const client = await this.deps.pool.connect();
      client.on('notification', (message) => {
        if (message.channel === RENDER_CHANGES_CHANNEL && message.payload) {
          this.emit('change', message.payload);
        }
      });
      client.on('error', (error) => {
        this.deps.logger.warn({ err: error }, 'Render notification connection lost; reconnecting');
        if (this.#listener === client) this.#listener = undefined;
        client.release(error);
        this.#retryListen();
      });
      await client.query(`LISTEN ${RENDER_CHANGES_CHANNEL}`);
      if (this.#stopped) {
        client.release();
        return;
      }
      this.#listener = client;
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Could not listen for render changes; retrying');
      this.#retryListen();
    }
  }

  #retryListen() {
    if (this.#stopped) return;
    setTimeout(() => void this.#listen(), 2_000).unref();
  }

  /** A worker stopped renewing the job's lock (crash or freeze); BullMQ retries it. */
  async #stalled(jobId: string): Promise<void> {
    try {
      await store.logJobEvent(this.deps.pool, jobId, {
        level: 'warn',
        message: 'The render worker stopped responding; the job will be retried',
      });
    } catch (error) {
      this.deps.logger.warn({ err: error, renderJobId: jobId }, 'Could not log a stalled job');
    }
  }

  /** Re-checks every job PostgreSQL considers unfinished. */
  async reconcile(): Promise<void> {
    try {
      for (const job of await store.listUnfinishedJobs(this.deps.pool)) await this.sync(job.id);
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Reconciliation failed');
    }
  }

  /** Records a final state BullMQ reached without the worker recording it. */
  async sync(jobId: string): Promise<void> {
    const { pool, queues, logger } = this.deps;
    try {
      const job = await store.getJob(pool, jobId);
      if (!job || isTerminalRenderStatus(job.status)) return;
      const queue = queues.byName(job.queueName);
      const state = queue ? await queue.getJobState(jobId) : 'unknown';
      if (state === 'unknown') {
        await this.#missing(job);
        return;
      }
      const queueJob = await queue!.getJob(jobId);
      if (state === 'failed') {
        const reason = queueJob?.failedReason ?? 'Render failed';
        if (job.cancelRequestedAt || reason === RENDER_CANCELLED_MESSAGE) {
          await this.#cancel(job.id);
          return;
        }
        const crashed = /stalled/i.test(reason);
        await store.transitionJob(pool, job.id, {
          status: 'failed',
          errorCode: crashed ? 'WORKER_CRASHED' : 'RENDER_FAILED',
          errorMessage: reason,
          message: 'Render failed',
          log: {
            level: 'error',
            message: crashed
              ? 'Render failed: the render worker stopped responding repeatedly'
              : `Render failed: ${reason}`,
          },
        });
      } else if (state === 'completed') {
        // The worker stores the output before completing the queue job, so this means its
        // result was lost (e.g. the database failed after the render).
        await store.transitionJob(pool, job.id, {
          status: 'failed',
          errorCode: 'DATABASE_FAILED',
          errorMessage: 'The worker finished but its result was not recorded',
          message: 'Render result was not recorded',
          log: { level: 'error', message: 'The worker finished but its result was not recorded' },
        });
      } else if (job.cancelRequestedAt && state !== 'active') {
        // Cancellation was requested but the job is back in the queue: never run it again.
        await queueJob?.remove().catch(() => undefined);
        await this.#cancel(job.id);
      }
    } catch (error) {
      logger.error({ err: error, renderJobId: jobId }, 'Job sync failed');
    }
  }

  async #cancel(jobId: string) {
    await store.transitionJob(this.deps.pool, jobId, {
      status: 'cancelled',
      errorCode: 'CANCELLED',
      message: 'Render cancelled',
      log: { level: 'warn', message: 'Render cancelled' },
    });
  }

  async #missing(job: store.JobRecord): Promise<void> {
    if (job.cancelRequestedAt) {
      await this.#cancel(job.id);
      return;
    }
    if (Date.now() - Date.parse(job.updatedAt) < LOST_AFTER_MS || !this.#requeue) return;
    this.deps.logger.warn({ renderJobId: job.id }, 'Job missing from the queue; re-queueing');
    await this.#requeue(job);
    await store.transitionJob(this.deps.pool, job.id, {
      status: 'pending',
      percent: 0,
      message: 'Re-queued',
      log: {
        level: 'warn',
        message: 'Job was missing from the render queue and has been re-queued',
      },
    });
  }
}
