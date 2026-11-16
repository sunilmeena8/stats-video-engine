import type { Logger } from '@statsopedia/utils/node';
import express, { type ErrorRequestHandler, type Express, type Request } from 'express';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';

import type { LocalStorage } from '@statsopedia/utils/node';
import type pg from 'pg';

import { authenticate, writesNeedEditor } from './auth/middleware.js';
import { createAuthRouter } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import { createDatasetsRouter } from './datasets/routes.js';
import type { DatasetService } from './datasets/service.js';
import { PG_ERROR, pgErrorCode } from './db/database.js';
import { clientIp, rateLimit } from './http/rate-limit.js';
import type { AudioAnalyzer } from './media/audio.js';
import { createMediaRouter } from './media/media.js';
import { createProjectsRouter } from './projects/routes.js';
import type { ProjectService } from './projects/projects.js';
import type { RenderMonitor } from './render/monitor.js';
import type { RenderOrchestrator } from './render/orchestrator.js';
import { createStatsRouter } from './stats/stats.js';
import { createJobsRouter, createOutputsRouter, createRendersRouter } from './render/routes.js';
import { createTemplatesRouter } from './templates/templates.js';
import { createTopicsRouter } from './topics/topics.js';
import { HttpError } from './errors.js';
import { createHealthRouter, type DependencyCheck, type ServiceInfo } from './health.js';

export interface AppDependencies {
  logger: Logger;
  service: ServiceInfo;
  readinessChecks: readonly DependencyCheck[];
  healthCheckTimeoutMs: number;
  /** Everything under /api (omitted in health-only tests). */
  api?: ApiServices | undefined;
}

export interface ApiServices {
  pool: pg.Pool;
  storage: LocalStorage;
  auth: AuthService;
  datasets: DatasetService;
  projects: ProjectService;
  orchestrator: RenderOrchestrator;
  monitor: RenderMonitor;
  /** Measures uploaded music (FFmpeg). */
  audio: AudioAnalyzer;
  limits: {
    csvUploadBytes: number;
    mediaUploadBytes: number;
    /** Authenticated requests per user per minute. */
    requestsPerMinute: number;
    /** Uploads (CSV imports/validations, media) per user per hour. */
    uploadsPerHour: number;
  };
}

interface ErrorBody {
  error: { code: string; message: string; issues?: unknown; details?: unknown };
}

/** Errors raised by Express middleware (e.g. body-parser) that carry a safe HTTP status. */
function isExposedHttpError(
  error: unknown,
): error is { status: number; expose: true; message: string; type?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    'expose' in error &&
    error.expose === true
  );
}

/** Maps errors to JSON responses without leaking internals for unexpected failures. */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    const body: ErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    if (error.status >= 500) req.log.error({ err: error }, 'Request failed');
    res.status(error.status).json(body);
    return;
  }
  if (pgErrorCode(error) === PG_ERROR.undefinedTable) {
    req.log.error({ err: error }, 'Database schema is missing');
    const body: ErrorBody = {
      error: {
        code: 'DATABASE_NOT_MIGRATED',
        message:
          'The database schema is not installed; run `pnpm --filter @statsopedia/api db:migrate`',
      },
    };
    res.status(503).json(body);
    return;
  }
  if (error instanceof ZodError) {
    const body: ErrorBody = {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', issues: error.issues },
    };
    res.status(400).json(body);
    return;
  }
  if (isExposedHttpError(error) && error.status >= 400 && error.status < 500) {
    const tooLarge = error.type === 'entity.too.large';
    const body: ErrorBody = {
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : (error.type ?? 'BAD_REQUEST'),
        message: tooLarge ? 'The upload exceeds the size limit' : error.message,
      },
    };
    res.status(error.status).json(body);
    return;
  }
  req.log.error({ err: error }, 'Unhandled request error');
  const body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  res.status(500).json(body);
};

/** Builds the Express app from injected dependencies, so tests can supply fakes. */
export function createApp({
  logger,
  service,
  readinessChecks,
  healthCheckTimeoutMs,
  api,
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });

  app.use(
    pinoHttp({
      logger,
      // Probes hit health endpoints constantly; failures are logged by the router itself.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/health',
    createHealthRouter({ service, readinessChecks, timeoutMs: healthCheckTimeoutMs, logger }),
  );

  if (api) mountApi(app, api, logger);

  app.use((req, res) => {
    const body: ErrorBody = {
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    };
    res.status(404).json(body);
  });
  app.use(errorHandler);

  return app;
}

function mountApi(app: Express, api: ApiServices, logger: Logger): void {
  const { pool, storage, auth, limits } = api;
  const userKey = (req: Request) => {
    const user = req.res?.locals.user as { id?: string } | undefined;
    return user?.id ?? clientIp(req);
  };

  app.use('/api/auth', createAuthRouter(auth));

  // Everything else under /api needs a session; writes need the editor role.
  app.use(
    '/api',
    rateLimit({ name: 'ip', windowMs: 60_000, max: limits.requestsPerMinute * 2, key: clientIp }),
    authenticate(auth),
    rateLimit({ name: 'user', windowMs: 60_000, max: limits.requestsPerMinute, key: userKey }),
    writesNeedEditor,
  );
  app.post(
    ['/api/datasets/:id/import', '/api/datasets/:id/validate', '/api/media'],
    rateLimit({ name: 'upload', windowMs: 3_600_000, max: limits.uploadsPerHour, key: userKey }),
  );

  app.use(
    '/api/datasets',
    createDatasetsRouter({ service: api.datasets, maxUploadBytes: limits.csvUploadBytes }),
  );
  app.use('/api/topics', createTopicsRouter(pool));
  app.use('/api/templates', createTemplatesRouter(pool));
  app.use(
    '/api/media',
    createMediaRouter({
      pool,
      storage,
      maxUploadBytes: limits.mediaUploadBytes,
      audio: api.audio,
    }),
  );
  app.use(
    '/api/projects',
    createProjectsRouter({ projects: api.projects, orchestrator: api.orchestrator }),
  );
  app.use(
    '/api/jobs',
    createJobsRouter({ pool, orchestrator: api.orchestrator, monitor: api.monitor, logger }),
  );
  app.use(
    '/api/renders',
    createRendersRouter({ pool, orchestrator: api.orchestrator, monitor: api.monitor, logger }),
  );
  app.use('/api/outputs', createOutputsRouter({ pool, storage }));
  app.use('/api/stats', createStatsRouter({ pool, storage }));
}
