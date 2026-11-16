import * as store from '@statsopedia/render-store';
import {
  RENDER_JOB_STATUSES,
  RENDER_KINDS,
  isTerminalRenderStatus,
  type RenderJobEvent,
} from '@statsopedia/shared-types';
import type { LocalStorage, Logger } from '@statsopedia/utils/node';
import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';

import { currentUser, requireRole } from '../auth/middleware.js';
import { notFound } from '../errors.js';
import { sendStorageFile } from '../http/files.js';
import type { RenderMonitor } from './monitor.js';
import type { RenderOrchestrator } from './orchestrator.js';

const idParams = z.object({ id: z.uuid() });
const listQuery = z
  .object({
    projectId: z.uuid().optional(),
    status: z.enum(RENDER_JOB_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const outputsQuery = z
  .object({
    kind: z.enum(RENDER_KINDS).optional(),
    projectId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

const HEARTBEAT_MS = 15_000;

interface StreamSource {
  /** Render jobs whose log entries the stream carries. */
  jobIds: string[];
  /** Current state (sent as `state` when it changes) and whether it is final. */
  load(): Promise<{ state: unknown; done: boolean; end: () => Promise<unknown> }>;
}

/**
 * Server-Sent Events for a job or a request: `state` (whenever it changes), `log` (render log
 * entries; their ids are the SSE ids) and a final `end`, after which the stream closes.
 *
 * Reconnecting clients send Last-Event-ID and receive only the entries they missed. Updates are
 * triggered by PostgreSQL notifications, with a periodic re-check in case one is missed, and
 * always read from the database, so the stream is correct whichever process wrote the change.
 */
function streamEvents(
  req: Request,
  res: Response,
  { pool, monitor, logger }: { pool: pg.Pool; monitor: RenderMonitor; logger: Logger },
  source: StreamSource,
): void {
  const lastEventId = Number(req.get('last-event-id') ?? req.query.lastEventId ?? 0) || 0;
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const send = (event: string, data: unknown, eventId?: number) => {
    if (res.writableEnded) return;
    res.write(
      `${eventId === undefined ? '' : `id: ${eventId}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  };

  let sentUpTo = lastEventId;
  let lastState = '';
  let closed = false;
  let running: Promise<void> | null = null;
  let again = false;
  const ids = new Set(source.jobIds);

  const refresh = async (): Promise<void> => {
    const { state, done, end } = await source.load();
    const serialized = JSON.stringify(state);
    if (serialized !== lastState) {
      lastState = serialized;
      send('state', state);
    }
    // Read after the state, so the log contains at least everything that led to it.
    const events: RenderJobEvent[] = await store.listEvents(pool, source.jobIds, {
      afterId: sentUpTo,
      limit: 1_000,
    });
    for (const event of events) {
      sentUpTo = event.id;
      send('log', event, event.id);
    }
    if (done) {
      closed = true;
      cleanup();
      send('end', await end());
      res.end();
    }
  };
  // One refresh at a time; changes arriving meanwhile trigger exactly one more.
  const schedule = () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = refresh()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'SSE refresh failed');
        closed = true;
        cleanup();
        res.end();
      })
      .finally(() => {
        running = null;
        if (again && !closed) {
          again = false;
          schedule();
        }
      });
  };

  const onChange = (jobId: string) => {
    if (ids.has(jobId)) schedule();
  };
  monitor.on('change', onChange); // subscribe before the first read, so nothing is missed
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
    schedule(); // safety net for a missed notification
  }, HEARTBEAT_MS);
  const cleanup = () => {
    clearInterval(heartbeat);
    monitor.off('change', onChange);
  };
  req.on('close', () => {
    closed = true;
    cleanup();
  });
  schedule();
}

export function createJobsRouter({
  pool,
  orchestrator,
  monitor,
  logger,
}: {
  pool: pg.Pool;
  orchestrator: RenderOrchestrator;
  monitor: RenderMonitor;
  logger: Logger;
}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const jobs = await store.listJobs(pool, listQuery.parse(req.query));
    res.json({ jobs: jobs.map(store.publicJob) });
  });

  /**
   * Server-Sent Events for the whole queue: a `job` event (the job) whenever any job changes.
   * Clients load the list first and apply these on top; on reconnect they reload the list.
   */
  router.get('/events', (req: Request, res: Response) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    // Coalesce bursts (progress, log entries): one read per job per tick.
    const due = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const flush = async () => {
      timer = undefined;
      const ids = [...due];
      due.clear();
      for (const id of ids) {
        const job = await store.getJob(pool, id);
        if (job && !res.writableEnded) {
          res.write(`event: job\ndata: ${JSON.stringify(store.publicJob(job))}\n\n`);
        }
      }
    };
    const onChange = (jobId: string) => {
      due.add(jobId);
      timer ??= setTimeout(() => {
        flush().catch((error: unknown) => logger.warn({ err: error }, 'Queue stream failed'));
      }, 250);
    };
    monitor.on('change', onChange);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(timer);
      monitor.off('change', onChange);
    });
  });

  router.post('/:id/retry', requireRole('editor'), async (req, res) => {
    const { id } = idParams.parse(req.params);
    const result = await orchestrator.retry(id, currentUser(res).id);
    res.status(result.replayed ? 200 : 202).json(result);
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const job = await store.getJob(pool, id);
    if (!job) throw notFound('Render job');
    const [manifest, output, events] = await Promise.all([
      store.getManifest(pool, job.manifestId),
      store.outputForJob(pool, id),
      store.listEvents(pool, id, { limit: 100 }),
    ]);
    res.json({
      job: store.publicJob(job),
      manifest: store.publicManifest(manifest!),
      output: output ? store.publicOutput(output) : null,
      events,
    });
  });

  router.post('/:id/cancel', requireRole('editor'), async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json({ job: await orchestrator.cancel(id) });
  });

  router.get('/:id/events', async (req, res) => {
    const { id } = idParams.parse(req.params);
    if (!(await store.getJob(pool, id))) throw notFound('Render job');
    streamEvents(
      req,
      res,
      { pool, monitor, logger },
      {
        jobIds: [id],
        async load() {
          const job = (await store.getJob(pool, id))!;
          return {
            state: store.publicJob(job),
            done: isTerminalRenderStatus(job.status),
            end: async () => {
              const output = await store.outputForJob(pool, id);
              return {
                job: store.publicJob(job),
                output: output ? store.publicOutput(output) : null,
              };
            },
          };
        },
      },
    );
  });

  return router;
}

/** Render requests: one submission (preview, long-form, Short or both) and its jobs. */
export function createRendersRouter({
  pool,
  orchestrator,
  monitor,
  logger,
}: {
  pool: pg.Pool;
  orchestrator: RenderOrchestrator;
  monitor: RenderMonitor;
  logger: Logger;
}): Router {
  const router = Router();
  const load = async (id: string) => {
    const request = await store.loadPublicRequest(pool, id);
    if (!request) throw notFound('Render request');
    return request;
  };

  router.get('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const request = await load(id);
    const outputs = await store.outputsForRequest(pool, id);
    res.json({ request, outputs: outputs.map(store.publicOutput) });
  });

  router.post('/:id/cancel', requireRole('editor'), async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json({ request: await orchestrator.cancelRequest(id) });
  });

  router.get('/:id/events', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const initial = await load(id);
    streamEvents(
      req,
      res,
      { pool, monitor, logger },
      {
        jobIds: initial.jobs.map((job) => job.id),
        async load() {
          const request = await load(id);
          return {
            state: request,
            done: request.jobs.every((job) => isTerminalRenderStatus(job.status)),
            end: async () => ({
              request,
              outputs: (await store.outputsForRequest(pool, id)).map(store.publicOutput),
            }),
          };
        },
      },
    );
  });

  return router;
}

export function createOutputsRouter({
  pool,
  storage,
}: {
  pool: pg.Pool;
  storage: LocalStorage;
}): Router {
  const router = Router();
  const load = async (req: Request) => {
    const { id } = idParams.parse(req.params);
    const output = await store.getOutput(pool, id);
    if (!output) throw notFound('Output');
    return output;
  };

  router.get('/', async (req, res) => {
    const filter = outputsQuery.parse(req.query);
    res.json({ outputs: await store.listOutputItems(pool, filter) });
  });

  router.get('/:id', async (req, res) => {
    res.json(store.publicOutput(await load(req)));
  });

  router.get('/:id/download', async (req, res) => {
    const output = await load(req);
    await sendStorageFile(
      req,
      res,
      storage,
      output.storageKey,
      'video/mp4',
      `statsopedia-${output.format}-v${output.renderVersion}.mp4`,
    );
  });

  router.get('/:id/thumbnail', async (req, res) => {
    const output = await load(req);
    if (!output.thumbnailKey) throw notFound('Thumbnail');
    await sendStorageFile(
      req,
      res,
      storage,
      output.thumbnailKey,
      'image/jpeg',
      `thumbnail-${output.format}-v${output.renderVersion}.jpg`,
    );
  });

  return router;
}
