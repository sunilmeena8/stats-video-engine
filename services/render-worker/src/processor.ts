import { getJob, transitionJob } from '@statsopedia/render-store';
import { renderJobPayloadSchema } from '@statsopedia/shared-schemas';
import {
  RENDER_CANCELLED_MESSAGE,
  isTerminalRenderStatus,
  type RenderJobPayload,
  type RenderJobResult,
  type RenderProgress,
} from '@statsopedia/shared-types';
import { UnrecoverableError, WaitingError } from 'bullmq';
import { z } from 'zod';

import { JobSupersededError, classifyError, retryableError } from './errors.js';
import { recordFailure, runRenderJob, type PipelineDependencies } from './pipeline.js';

/** Abort reason used when a user cancels a job (versus shutdown or timeout). */
export const USER_CANCEL_REASON = 'cancelled-by-user';
/** failedReason of a user-cancelled job in BullMQ. */
export const CANCELLED_MESSAGE = RENDER_CANCELLED_MESSAGE;
const TIMEOUT_REASON = 'render-timeout';

/** The parts of a BullMQ job the processor uses (a real `Job` satisfies this). */
export interface ProcessableJob {
  id?: string | undefined;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
  updateProgress(progress: RenderProgress): Promise<void>;
  moveToWait(token?: string): Promise<number>;
}

export interface ProcessorOptions extends PipelineDependencies {
  /** True when a user cancelled the job (checked before every attempt). */
  isCancelled: (renderJobId: string) => Promise<boolean>;
  /** Longest an attempt may run, per kind. */
  timeoutMs: { preview: number; final: number };
  /** Replaces the pipeline (tests). */
  run?: typeof runRenderJob;
}

/**
 * The BullMQ processor. `signal` comes from BullMQ and is aborted when a user cancels the job
 * or the worker shuts down; a timer aborts it when the attempt runs too long.
 *
 * Outcomes, all recorded in PostgreSQL by the worker itself:
 * - success → `completed` (output stored by the pipeline)
 * - user cancellation → `cancelled`, never retried
 * - worker shutdown → back to `pending` and the queue, without using up an attempt
 * - permanent error, or the last attempt failing → `failed` with its error code
 * - retryable error with attempts left → `pending`; BullMQ retries after a backoff
 */
export function createRenderProcessor(options: ProcessorOptions) {
  const { logger, isCancelled, timeoutMs, run = runRenderJob } = options;

  return async function processRenderJob(
    job: ProcessableJob,
    token?: string,
    signal?: AbortSignal,
  ): Promise<RenderJobResult> {
    // Queue data is external input: validate it even though the producer already did.
    const parsed = renderJobPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid render job payload:\n${z.prettifyError(parsed.error)}`);
    }
    const payload = parsed.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const log = logger.child({ renderJobId: payload.renderJobId, attempt });

    if (await isCancelled(payload.renderJobId)) {
      // Cancelled while waiting (e.g. between retries): never start another attempt.
      await markCancelled(payload);
      throw new UnrecoverableError(CANCELLED_MESSAGE);
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(TIMEOUT_REASON), timeoutMs[payload.kind]);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    log.info({ kind: payload.kind, format: payload.outputFormat, maxAttempts }, 'Render started');

    try {
      combined.throwIfAborted(); // cancelled or stopping before the attempt started
      return await run(options, payload, {
        number: attempt,
        maxAttempts,
        signal: combined,
        reportToQueue: (progress) => {
          job.updateProgress(progress).catch((error: unknown) => {
            log.warn({ err: error }, 'Failed to report progress to the queue');
          });
        },
      });
    } catch (error) {
      if (error instanceof JobSupersededError) {
        // Cancelled or finished elsewhere. Record a pending cancellation; touch nothing else.
        const current = await getJob(options.pool, payload.renderJobId).catch(() => null);
        if (current?.cancelRequestedAt && !isTerminalRenderStatus(current.status)) {
          await markCancelled(payload);
        }
        log.info({ reason: error.message }, 'Render stopped');
        throw new UnrecoverableError(
          current?.cancelRequestedAt ? CANCELLED_MESSAGE : error.message,
        );
      }
      if (signal?.aborted && signal.reason === USER_CANCEL_REASON) {
        await markCancelled(payload);
        log.info('Render cancelled by user');
        throw new UnrecoverableError(CANCELLED_MESSAGE);
      }
      if (signal?.aborted) {
        // Worker shutdown: hand the job back so the next worker renders it from scratch.
        await recordFailure(options, payload, {
          status: 'pending',
          message: 'Worker stopped; waiting for another worker',
          log: {
            level: 'warn',
            message: 'Worker stopped during the render; returned to the queue',
          },
        });
        await job.moveToWait(token);
        log.info(
          { reason: String(signal.reason) },
          'Render interrupted; job returned to the queue',
        );
        throw new WaitingError();
      }
      const failure = timeout.signal.aborted
        ? retryableError(
            'RENDER_TIMEOUT',
            `Render exceeded the ${Math.round(timeoutMs[payload.kind] / 60_000)} minute limit`,
          )
        : classifyError(error);
      const last = !failure.retryable || attempt >= maxAttempts;
      log.error(
        { err: error, code: failure.code, retryable: failure.retryable, last },
        last ? 'Render failed' : 'Render attempt failed; will retry',
      );
      await recordFailure(options, payload, {
        status: last ? 'failed' : 'pending',
        errorCode: failure.code,
        errorMessage: failure.message,
        message: last ? 'Render failed' : 'Waiting to retry',
        log: last
          ? {
              level: 'error',
              message: `Render failed after ${attempt} attempt(s) (${failure.code}): ${failure.message}`,
            }
          : {
              level: 'warn',
              message: `Attempt ${attempt} of ${maxAttempts} failed (${failure.code}): ${failure.message}; retrying`,
            },
      });
      // Permanent errors must not be retried by BullMQ; retryable ones keep their message.
      if (last) throw new UnrecoverableError(`${failure.code}: ${failure.message}`);
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  };

  async function markCancelled(payload: RenderJobPayload) {
    await transitionJob(options.pool, payload.renderJobId, {
      status: 'cancelled',
      errorCode: 'CANCELLED',
      message: 'Render cancelled',
      log: { level: 'warn', message: 'Render cancelled' },
    }).catch((error: unknown) =>
      logger.error(
        { err: error, renderJobId: payload.renderJobId },
        'Could not record cancellation',
      ),
    );
  }
}
