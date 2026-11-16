import { createHash, randomUUID } from 'node:crypto';

import * as store from '@statsopedia/render-store';
import { barChartRacePropsSchema } from '@statsopedia/shared-schemas';
import {
  REDIS_CHANNELS,
  isTerminalRenderStatus,
  type OutputFormat,
  type RenderJob,
  type RenderJobPayload,
  type RenderKind,
  type RenderRequest,
  type RenderSubmissionResponse,
} from '@statsopedia/shared-types';
import { canonicalJson } from '@statsopedia/utils';
import { storageKeys, type Logger } from '@statsopedia/utils/node';
import { checkRaceQuality } from '@statsopedia/chart-components/pure';
import { buildRaceConfig, formatsForMode, planRaceRender } from '@statsopedia/video-config';
import type pg from 'pg';
import { z } from 'zod';

import { HttpError, conflict, notFound, unprocessable } from '../errors.js';
import { musicLicenseSnapshot } from '../media/media.js';
import { getProject, type ProjectService } from '../projects/projects.js';
import { MAX_ATTEMPTS, type RenderQueues } from './queues.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface OrchestratorDependencies {
  pool: pg.Pool;
  queues: RenderQueues;
  projects: ProjectService;
  /** Publishes cancellation requests to workers. */
  publish: (channel: string, message: string) => Promise<unknown>;
  /** Marks a job cancelled in Redis so no further attempt can start. */
  flagCancelled: (jobId: string) => Promise<unknown>;
  logger: Logger;
}

interface PlannedRender {
  format: OutputFormat;
  manifest: store.ManifestRecord;
  duplicate: store.JobRecord | null;
}

/** The queue payload of a job: identifiers only; the worker loads everything else. */
export function payloadFor(job: store.JobRecord): RenderJobPayload {
  return {
    renderJobId: job.id,
    requestId: job.requestId,
    projectId: job.projectId,
    kind: job.kind,
    outputFormat: job.outputFormat,
  };
}

/**
 * Turns render submissions into persisted requests and jobs on the right queue. Everything is
 * validated and written to PostgreSQL first, so every queued job already has a record; the
 * queue only executes, and the worker records progress and results itself.
 */
export class RenderOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async submit({
    projectId,
    kind,
    formats: requested,
    idempotencyKey,
    userId,
  }: {
    projectId: string;
    kind: RenderKind;
    formats: OutputFormat[] | undefined;
    idempotencyKey: string | null;
    userId: string | null;
  }): Promise<RenderSubmissionResponse> {
    const { pool, projects, logger } = this.deps;
    const project = await getProject(pool, projectId);
    if (!project) throw notFound('Project');

    const allowed = formatsForMode(project.configuration.outputMode);
    const formats = (requested ?? allowed).toSorted();
    const outside = formats.filter((format) => !allowed.includes(format));
    if (outside.length) {
      throw unprocessable(
        'FORMAT_NOT_IN_MODE',
        `The project's output mode does not include: ${outside.join(', ')}`,
      );
    }
    const fingerprint = sha256(JSON.stringify({ revision: project.revision, kind, formats }));
    if (idempotencyKey) {
      const replay = await this.replay(projectId, kind, idempotencyKey, fingerprint);
      if (replay) return replay;
    }

    // Validate and build the exact renderer input before touching the queue.
    const context = await projects.resolve(pool, project.configuration);
    const plans: PlannedRender[] = [];
    for (const format of formats) {
      const raceConfig = buildRaceConfig(project.configuration, {
        format,
        kind,
        music: context.music,
        images: context.images,
      });
      const parsed = barChartRacePropsSchema.safeParse({
        dataset: context.normalized,
        config: raceConfig,
      });
      if (!parsed.success) {
        throw unprocessable('INVALID_RENDER_INPUT', z.prettifyError(parsed.error));
      }
      // The same checks the Studio shows. A failing one would make a broken or non-compliant
      // video, so nothing is queued.
      const quality = checkRaceQuality({
        props: parsed.data,
        kind,
        requestedVolume: project.configuration.music?.volume ?? null,
        musicAsset: context.musicAsset,
      });
      const failed = quality.checks.filter((check) => check.status === 'fail');
      if (failed.length) {
        throw unprocessable(
          'QUALITY_CHECK_FAILED',
          `${format === 'long' ? 'Long-form' : 'Shorts'}: ${failed.map((check) => `${check.title}: ${check.detail}`).join(' ')}`,
          { format, checks: failed },
        );
      }
      // The worker rebuilds the props from the database and refuses to render unless this
      // checksum matches (canonical JSON: jsonb does not preserve key order).
      const checksum = sha256(canonicalJson(parsed.data));
      plans.push({
        format,
        duplicate: idempotencyKey
          ? null
          : await store.findActiveDuplicate(pool, projectId, kind, format, checksum),
        manifest: {
          id: randomUUID(),
          projectId,
          kind,
          outputFormat: format,
          compositionId: context.template.compositionId,
          templateId: context.template.id,
          templateVersion: context.template.version,
          datasetVersionId: context.version.id,
          musicAssetId: context.musicAssetId,
          musicLicense: context.musicAsset ? musicLicenseSnapshot(context.musicAsset) : null,
          quality,
          raceConfig,
          propsChecksum: checksum,
          createdAt: new Date().toISOString(),
          thumbnailFrame: planRaceRender(parsed.data).thumbnailFrame,
        },
      });
    }

    // Without a key, an identical unfinished request is returned instead of rendering twice.
    const duplicateRequest = plans[0]?.duplicate?.requestId;
    if (duplicateRequest && plans.every((plan) => plan.duplicate?.requestId === duplicateRequest)) {
      const existing = await store.loadPublicRequest(pool, duplicateRequest);
      if (existing && existing.formats.length === formats.length) {
        return { request: existing, replayed: true };
      }
    }

    const requestId = randomUUID();
    let jobs: store.JobRecord[];
    try {
      jobs = await store.withTransaction(pool, async (client) => {
        await store.lockProject(client, projectId);
        const renderVersion = await store.nextRenderVersion(client, projectId);
        await store.insertRequest(client, {
          id: requestId,
          projectId,
          type: store.requestTypeFor(kind, formats),
          kind,
          formats,
          renderVersion,
          idempotencyKey,
          requestFingerprint: idempotencyKey ? fingerprint : null,
          createdBy: userId,
          createdAt: new Date().toISOString(),
        });
        for (const plan of plans) {
          const jobId = randomUUID();
          await store.insertManifest(client, plan.manifest);
          await store.insertJob(client, {
            id: jobId,
            requestId,
            projectId,
            manifestId: plan.manifest.id,
            kind,
            outputFormat: plan.format,
            renderVersion,
            outputKey: storageKeys.renderOutput({
              projectId,
              kind,
              format: plan.format,
              renderVersion,
            }),
            queueName: this.deps.queues.forKind(kind).name,
            maxAttempts: MAX_ATTEMPTS[kind],
            createdBy: userId,
          });
          await store.insertEvent(client, {
            renderJobId: jobId,
            level: 'info',
            status: 'pending',
            percent: 0,
            message: `${kind === 'final' ? 'Final' : 'Preview'} ${plan.format} render v${renderVersion} queued`,
          });
        }
        if (kind === 'final') await store.refreshProjectStatus(client, projectId);
        return store.jobsForRequest(client, requestId);
      });
    } catch (error) {
      // A concurrent submission with the same key won the race: return its request.
      if (idempotencyKey && store.pgErrorCode(error) === store.PG_ERROR.uniqueViolation) {
        const replay = await this.replay(projectId, kind, idempotencyKey, fingerprint);
        if (replay) return replay;
      }
      throw error;
    }

    try {
      for (const job of jobs) await this.deps.queues.enqueue(payloadFor(job));
    } catch (error) {
      logger.error({ err: error, requestId }, 'Could not enqueue render');
      for (const job of jobs) {
        await store.transitionJob(pool, job.id, {
          status: 'failed',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: 'Render queue unavailable',
          message: 'Render queue unavailable',
          log: {
            level: 'error',
            message: 'Render queue unavailable; submit again when it is back',
          },
        });
      }
      throw new HttpError(
        503,
        'QUEUE_UNAVAILABLE',
        'The render queue is unavailable; try again shortly',
      );
    }
    logger.info({ projectId, requestId, kind, formats }, 'Renders submitted');
    return { request: (await store.loadPublicRequest(pool, requestId))!, replayed: false };
  }

  /**
   * Cancels a job: removes it from the queue if it has not started, otherwise asks the worker
   * running it to stop (the worker records `cancelled`). Cancelling twice is harmless.
   */
  async cancel(jobId: string): Promise<RenderJob> {
    const { pool, queues, publish, logger } = this.deps;
    const job = await store.getJob(pool, jobId);
    if (!job) throw notFound('Render job');
    if (job.status === 'cancelled') return store.publicJob(job);
    if (isTerminalRenderStatus(job.status)) {
      throw conflict('JOB_FINISHED', `The job already ${job.status}`);
    }
    await this.deps.flagCancelled(jobId);
    await store.requestCancellation(pool, jobId);

    const queueJob = await queues.byName(job.queueName)?.getJob(jobId);
    const state = queueJob ? await queueJob.getState() : 'missing';
    let removed = state === 'missing';
    if (
      queueJob &&
      ['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'].includes(state)
    ) {
      try {
        await queueJob.remove();
        removed = true;
      } catch {
        removed = false; // a worker picked it up in the meantime
      }
    }
    if (removed) {
      await store.transitionJob(pool, jobId, {
        status: 'cancelled',
        errorCode: 'CANCELLED',
        message: 'Cancelled before rendering started',
        log: { level: 'warn', message: 'Cancelled before rendering started' },
      });
    } else {
      await publish(REDIS_CHANNELS.renderCancel, jobId);
      logger.info({ renderJobId: jobId, state }, 'Asked workers to cancel the render');
    }
    return store.publicJob((await store.getJob(pool, jobId))!);
  }

  /**
   * Renders a failed or cancelled job's format again, as a new request (with the project's
   * current configuration and a new render version).
   */
  async retry(jobId: string, userId: string | null): Promise<RenderSubmissionResponse> {
    const job = await store.getJob(this.deps.pool, jobId);
    if (!job) throw notFound('Render job');
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw conflict('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be rendered again');
    }
    return this.submit({
      projectId: job.projectId,
      kind: job.kind,
      formats: [job.outputFormat],
      idempotencyKey: null,
      userId,
    });
  }

  /** Cancels every unfinished job of a request. */
  async cancelRequest(requestId: string): Promise<RenderRequest> {
    const request = await store.loadPublicRequest(this.deps.pool, requestId);
    if (!request) throw notFound('Render request');
    for (const job of request.jobs) {
      if (!isTerminalRenderStatus(job.status)) await this.cancel(job.id);
    }
    return (await store.loadPublicRequest(this.deps.pool, requestId))!;
  }

  private async replay(
    projectId: string,
    kind: RenderKind,
    key: string,
    fingerprint: string,
  ): Promise<RenderSubmissionResponse | null> {
    const existing = await store.requestByIdempotencyKey(this.deps.pool, projectId, kind, key);
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint) {
      throw conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
      );
    }
    return {
      request: (await store.loadPublicRequest(this.deps.pool, existing.id))!,
      replayed: true,
    };
  }
}
