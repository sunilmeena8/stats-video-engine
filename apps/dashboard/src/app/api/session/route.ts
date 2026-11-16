import { loginRequestSchema, loginResponseSchema, userSchema } from '@statsopedia/shared-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/server/origin';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  readSessionToken,
  sessionCookieOptions,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const apiUrl = (path: string) => new URL(path, getServerEnv().API_BASE_URL);
const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** The signed-in user, or 401. */
export async function GET(): Promise<Response> {
  const token = await readSessionToken();
  if (!token) return error(401, 'UNAUTHENTICATED', 'Not signed in');
  try {
    const response = await fetch(apiUrl('/api/auth/me'), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      const reply = error(response.status, 'UNAUTHENTICATED', 'Session expired');
      if (response.status === 401) reply.cookies.set(SESSION_COOKIE, '', clearedSessionCookie());
      return reply;
    }
    // The page gets the user itself (the API wraps it as { user }).
    return NextResponse.json(z.object({ user: userSchema }).parse(await response.json()).user);
  } catch {
    return error(503, 'API_UNREACHABLE', 'The API is not reachable');
  }
}

/**
 * Signs in: exchanges email and password for an API session and keeps its token in an
 * httpOnly cookie. The token is never returned to the page.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return error(403, 'FORBIDDEN', 'Cross-site request refused');
  const body: unknown = await request.json().catch(() => null);
  const credentials = loginRequestSchema.safeParse(body);
  if (!credentials.success) {
    return error(400, 'VALIDATION_ERROR', 'Enter your email address and password');
  }
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials.data),
      cache: 'no-store',
    });
  } catch {
    return error(503, 'API_UNREACHABLE', 'The API is not reachable');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      payload ?? { error: { code: 'HTTP_ERROR', message: 'Sign-in failed' } },
      {
        status: response.status,
      },
    );
  }
  const session = loginResponseSchema.parse(payload);
  const reply = NextResponse.json({ user: session.user });
  reply.cookies.set(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(new Date(session.expiresAt)),
  );
  return reply;
}

/** Signs out: revokes the API session and clears the cookie. */
export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return error(403, 'FORBIDDEN', 'Cross-site request refused');
  const token = await readSessionToken();
  if (token) {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const reply = new NextResponse(null, { status: 204 });
  reply.cookies.set(SESSION_COOKIE, '', clearedSessionCookie());
  return reply;
}
