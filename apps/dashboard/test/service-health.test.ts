import type { HealthResponse } from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import { getServerEnv } from '../src/lib/env';
import { probeService } from '../src/lib/service-health';

const health: HealthResponse = {
  status: 'degraded',
  service: 'api',
  version: '0.1.0',
  uptimeSeconds: 12.5,
  timestamp: '2026-11-09T12:00:00.000Z',
  checks: { redis: { status: 'down', latencyMs: 3, error: 'connect ECONNREFUSED' } },
};

const respond =
  (body: unknown, status = 200): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );

describe('probeService', () => {
  it('treats a 503 with a valid body as reachable but degraded', async () => {
    const probe = await probeService('http://api/health/ready', {
      timeoutMs: 100,
      fetchImpl: respond(health, 503),
    });
    expect(probe).toEqual({ state: 'reachable', httpStatus: 503, health });
  });

  it('flags bodies that break the shared health contract', async () => {
    const probe = await probeService('http://api/health', {
      timeoutMs: 100,
      fetchImpl: respond({ status: 'fine' }),
    });
    expect(probe.state).toBe('invalid-response');
  });

  it('flags non-JSON bodies', async () => {
    const probe = await probeService('http://api/health', {
      timeoutMs: 100,
      fetchImpl: respond('<html>'),
    });
    expect(probe).toEqual({
      state: 'invalid-response',
      httpStatus: 200,
      error: 'Body is not JSON',
    });
  });

  it('explains refused connections', async () => {
    const refused: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    const probe = await probeService('http://api/health', { timeoutMs: 100, fetchImpl: refused });
    expect(probe).toEqual({
      state: 'unreachable',
      error: 'Connection refused (is the service running?)',
    });
  });

  it('reports timeouts', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    const probe = await probeService('http://api/health', { timeoutMs: 20, fetchImpl: hanging });
    expect(probe).toEqual({ state: 'unreachable', error: 'Timed out after 20ms' });
  });
});

describe('getServerEnv', () => {
  it('defaults to local service URLs', () => {
    expect(getServerEnv({})).toEqual({
      API_BASE_URL: 'http://127.0.0.1:4000',
      DATA_PROCESSOR_BASE_URL: 'http://127.0.0.1:8000',
      HEALTH_PROBE_TIMEOUT_MS: 2500,
      // Secure cookies follow NODE_ENV (tests run outside production).
      SESSION_COOKIE_SECURE: false,
    });
    expect(getServerEnv({ SESSION_COOKIE_SECURE: 'true' }).SESSION_COOKIE_SECURE).toBe(true);
  });

  it('rejects non-HTTP URLs', () => {
    expect(() => getServerEnv({ API_BASE_URL: 'ftp://example.com' })).toThrow(/API_BASE_URL/);
  });
});
