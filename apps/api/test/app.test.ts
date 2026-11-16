import { healthResponseSchema } from '@statsopedia/shared-schemas';
import { createLogger } from '@statsopedia/utils/node';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp, errorHandler } from '../src/app.js';
import { createRedisCheck, type DependencyCheck } from '../src/health.js';

const logger = createLogger({ service: 'api-test', level: 'silent' });

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});
const errorOf = (body: unknown) => errorBodySchema.parse(body).error;

function buildApp(readinessChecks: DependencyCheck[] = [], healthCheckTimeoutMs = 500) {
  return createApp({
    logger,
    service: { name: 'api', version: '9.9.9', startedAt: new Date() },
    readinessChecks,
    healthCheckTimeoutMs,
  });
}

const up = (name: string): DependencyCheck => ({ name, check: () => Promise.resolve() });
const down = (name: string, message: string): DependencyCheck => ({
  name,
  check: () => Promise.reject(new Error(message)),
});

describe('GET /health', () => {
  it('reports liveness without touching dependencies', async () => {
    const response = await request(buildApp([down('postgres', 'should not run')])).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = healthResponseSchema.parse(response.body);
    expect(body).toMatchObject({ status: 'ok', service: 'api', version: '9.9.9', checks: {} });
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every dependency is up', async () => {
    const response = await request(buildApp([up('postgres'), up('redis')])).get('/health/ready');

    expect(response.status).toBe(200);
    const body = healthResponseSchema.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.checks.postgres?.status).toBe('up');
    expect(body.checks.redis?.status).toBe('up');
  });

  it('returns 503 and the failure reason when a dependency is down', async () => {
    const response = await request(
      buildApp([up('postgres'), down('redis', 'connect ECONNREFUSED 127.0.0.1:6379')]),
    ).get('/health/ready');

    expect(response.status).toBe(503);
    const body = healthResponseSchema.parse(response.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toMatchObject({
      status: 'down',
      error: 'connect ECONNREFUSED 127.0.0.1:6379',
    });
    expect(body.checks.postgres?.status).toBe('up');
  });

  it('marks a hanging dependency as down after the timeout', async () => {
    const hanging: DependencyCheck = { name: 'postgres', check: () => new Promise(() => {}) };
    const response = await request(buildApp([hanging], 50)).get('/health/ready');

    expect(response.status).toBe(503);
    expect(healthResponseSchema.parse(response.body).checks.postgres?.error).toBe(
      'Timed out after 50ms',
    );
  });

  it('treats an unexpected Redis PING reply as down', async () => {
    const check = createRedisCheck({ status: 'ready', ping: () => Promise.resolve('LOADING') });
    await expect(check.check()).rejects.toThrow('Unexpected PING reply: LOADING');
  });

  it('reports a disconnected Redis client without sending a command', async () => {
    const ping = vi.fn(() => Promise.resolve('PONG'));
    const check = createRedisCheck({ status: 'reconnecting', ping });
    await expect(check.check()).rejects.toThrow('Not connected (connection status: reconnecting)');
    expect(ping).not.toHaveBeenCalled();
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(buildApp()).get('/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /nope' },
    });
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const response = await request(buildApp())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('entity.parse.failed');
  });

  function appThatThrows(error: unknown) {
    const app = express();
    app.use((req, _res, next) => {
      // pino-http normally attaches req.log.
      Object.assign(req, { log: logger });
      next();
    });
    app.get('/boom', () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it('maps validation errors to 400 with issues', async () => {
    const zodError = z.object({ id: z.uuid() }).safeParse({ id: 'x' }).error;
    const response = await request(appThatThrows(zodError)).get('/boom');
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(response.body).issues).toHaveLength(1);
  });

  it('hides internal error details behind a generic 500', async () => {
    const response = await request(appThatThrows(new Error('secret connection string'))).get(
      '/boom',
    );
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });
});
