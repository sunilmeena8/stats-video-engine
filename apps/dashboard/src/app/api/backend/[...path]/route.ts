import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/server/origin';
import { SESSION_COOKIE, clearedSessionCookie, readSessionToken } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Request headers passed to the API (everything else, cookies included, stays here). */
const FORWARD_REQUEST = [
  'accept',
  'content-type',
  'range',
  'if-range',
  'idempotency-key',
  'last-event-id',
];
/** Response headers passed back to the browser. */
const FORWARD_RESPONSE = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
];
const SEGMENT = /^[A-Za-z0-9._-]+$/;

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Backend-for-frontend proxy: `/api/backend/<path>` → `<API_BASE_URL>/api/<path>`, adding the
 * signed-in user's token from the httpOnly session cookie. Bodies and responses are streamed
 * (CSV and media uploads, video downloads with ranges, Server-Sent Events). The API stays on a
 * private address and does all validation and authorization.
 */
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  if (!path.length || path.some((segment) => !SEGMENT.test(segment) || segment === '..')) {
    return fail(400, 'BAD_REQUEST', 'Invalid API path');
  }
  // Sessions are managed by /api/session only.
  if (path[0] === 'auth' && path[1] !== 'me') return fail(404, 'NOT_FOUND', 'Not found');
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) {
    return fail(403, 'FORBIDDEN', 'Cross-site request refused');
  }
  const token = await readSessionToken();
  if (!token) return fail(401, 'UNAUTHENTICATED', 'Not signed in');

  const target = new URL(`/api/${path.join('/')}`, getServerEnv().API_BASE_URL);
  target.search = request.nextUrl.search;
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody =
    request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required by Node's fetch to stream a request body.
      ...(hasBody ? { duplex: 'half' } : {}),
      // Ends the upstream request (e.g. an event stream) when the browser goes away.
      signal: request.signal,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return fail(503, 'API_UNREACHABLE', 'The API is not reachable');
  }

  const responseHeaders = new Headers({ 'x-content-type-options': 'nosniff' });
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (responseHeaders.get('content-type')?.startsWith('text/event-stream')) {
    responseHeaders.set('cache-control', 'no-cache, no-transform');
    responseHeaders.set('x-accel-buffering', 'no');
  }
  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
  // The API no longer accepts the token (expired or revoked): drop it.
  if (upstream.status === 401) response.cookies.set(SESSION_COOKIE, '', clearedSessionCookie());
  return response;
}

export { proxy as DELETE, proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT };
