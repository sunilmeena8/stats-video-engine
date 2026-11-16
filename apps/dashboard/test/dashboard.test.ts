import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, api } from '../src/lib/api/client';
import { formatBytes, formatDuration, formatRank, formatRelative } from '../src/lib/format';
import { sameOrigin } from '../src/lib/server/origin';
import { canRetry, isActive, queueGroup } from '../src/lib/status';
import { proxy } from '../src/proxy';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch that answers every call with `body` (JSON) and `status`. */
const respond = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(Response.json(body, { status })));

describe('api client', () => {
  it('validates responses against the shared contract', async () => {
    vi.stubGlobal('fetch', respond({ count: 'three' }));
    await expect(api('/x', z.object({ count: z.number() }))).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('turns API errors into ApiError with code, message and issue details', async () => {
    vi.stubGlobal(
      'fetch',
      respond(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            issues: [{ path: ['configuration', 'topN'], message: 'Too big' }],
          },
        },
        400,
      ),
    );
    const error = await api('/projects', z.unknown()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
    });
    expect((error as ApiError).details).toEqual(['configuration.topN: Too big']);
  });

  it('calls the API through the dashboard proxy with query parameters', async () => {
    const fetchMock = respond({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await api('/jobs', z.object({ ok: z.boolean() }), { query: { limit: 5, status: undefined } });
    expect(fetchMock).toHaveBeenCalledWith('/api/backend/jobs?limit=5', expect.anything());
  });

  it('reports an unreachable server as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    await expect(api('/stats', z.unknown())).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('sameOrigin (CSRF guard)', () => {
  const request = (headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/session', { method: 'POST', headers });

  it('accepts same-origin and origin-less requests, refuses other sites', () => {
    expect(sameOrigin(request({ host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(
      true,
    );
    expect(sameOrigin(request({ host: 'localhost:3000' }))).toBe(true);
    expect(sameOrigin(request({ host: 'localhost:3000', origin: 'https://evil.example' }))).toBe(
      false,
    );
    expect(sameOrigin(request({ host: 'localhost:3000', origin: 'null' }))).toBe(false);
  });
});

describe('route protection', () => {
  it('sends visitors without a session to sign-in, keeping where they were going', () => {
    const response = proxy(new NextRequest('http://localhost:3000/projects/abc?tab=renders'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fprojects%2Fabc%3Ftab%3Drenders',
    );
  });

  it('lets requests with a session cookie through', () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { cookie: 'sp_session=abc' },
    });
    expect(proxy(request).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('status helpers', () => {
  it('groups jobs for the render queue and allows retry only when finished badly', () => {
    expect(queueGroup('pending')).toBe('queued');
    expect(queueGroup('validating')).toBe('processing');
    expect(queueGroup('post_processing')).toBe('processing');
    expect(queueGroup('completed')).toBe('completed');
    expect(queueGroup('cancelled')).toBe('failed');
    expect(isActive({ status: 'rendering' })).toBe(true);
    expect(isActive({ status: 'failed' })).toBe(false);
    expect(canRetry({ status: 'failed' })).toBe(true);
    expect(canRetry({ status: 'cancelled' })).toBe(true);
    expect(canRetry({ status: 'completed' })).toBe(false);
  });
});

describe('formatting', () => {
  it('formats sizes, durations, ranks and relative times', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(57_712_503)).toBe('55 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatDuration(24)).toBe('0:24');
    expect(formatDuration(3_723)).toBe('1:02:03');
    expect(formatRank(2, true)).toBe('2=');
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(formatRelative('2026-01-01T11:57:00Z', now)).toBe('3 minutes ago');
    expect(formatRelative('2026-01-01T11:59:58Z', now)).toBe('just now');
    expect(formatRelative(null)).toBe('—');
  });
});
