import type { DependencyCheckResult, HealthResponse } from '@statsopedia/shared-types';
import type { Logger } from '@statsopedia/utils/node';
import { Router } from 'express';

/** A named probe of an external dependency. Resolves when healthy, rejects otherwise. */
export interface DependencyCheck {
  name: string;
  check: () => Promise<void>;
}

export interface ServiceInfo {
  name: string;
  version: string;
  startedAt: Date;
}

export function createPostgresCheck(pool: {
  query: (sql: string) => Promise<unknown>;
}): DependencyCheck {
  return {
    name: 'postgres',
    check: async () => {
      await pool.query('SELECT 1');
    },
  };
}

export function createRedisCheck(redis: {
  status: string;
  ping: () => Promise<string>;
}): DependencyCheck {
  return {
    name: 'redis',
    check: async () => {
      // Without this, a disconnected client reports an opaque ioredis offline-queue error.
      if (redis.status !== 'ready') {
        throw new Error(`Not connected (connection status: ${redis.status})`);
      }
      const reply = await redis.ping();
      if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${reply}`);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs all checks concurrently; a slow or failing dependency never blocks the others. */
export async function runDependencyChecks(
  checks: readonly DependencyCheck[],
  timeoutMs: number,
): Promise<Record<string, DependencyCheckResult>> {
  const results = await Promise.all(
    checks.map(async ({ name, check }): Promise<[string, DependencyCheckResult]> => {
      const started = performance.now();
      const latency = () => Math.round((performance.now() - started) * 10) / 10;
      try {
        await withTimeout(check(), timeoutMs, `Timed out after ${timeoutMs}ms`);
        return [name, { status: 'up', latencyMs: latency(), error: null }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [name, { status: 'down', latencyMs: latency(), error: message || 'Unknown error' }];
      }
    }),
  );
  return Object.fromEntries(results);
}

export interface HealthRouterDependencies {
  service: ServiceInfo;
  readinessChecks: readonly DependencyCheck[];
  timeoutMs: number;
  logger: Logger;
}

/**
 * `GET /health`       liveness: the process is up and serving requests (never touches dependencies).
 * `GET /health/ready` readiness: PostgreSQL and Redis are reachable; 503 when any is down.
 */
export function createHealthRouter({
  service,
  readinessChecks,
  timeoutMs,
  logger,
}: HealthRouterDependencies): Router {
  const router = Router();

  const describe = () => ({
    service: service.name,
    version: service.version,
    uptimeSeconds: Math.round((Date.now() - service.startedAt.getTime()) / 100) / 10,
    timestamp: new Date().toISOString(),
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', (_req, res) => {
    const body: HealthResponse = { status: 'ok', ...describe(), checks: {} };
    res.json(body);
  });

  router.get('/ready', async (_req, res) => {
    const checks = await runDependencyChecks(readinessChecks, timeoutMs);
    const healthy = Object.values(checks).every((result) => result.status === 'up');
    if (!healthy) logger.warn({ checks }, 'Readiness check failed');
    const body: HealthResponse = { status: healthy ? 'ok' : 'degraded', ...describe(), checks };
    res.status(healthy ? 200 : 503).json(body);
  });

  return router;
}
