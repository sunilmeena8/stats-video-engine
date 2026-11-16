import 'server-only';

import { cookies } from 'next/headers';

import { getServerEnv } from '../env';

/** httpOnly cookie holding the API session token; JavaScript in the page never sees it. */
export const SESSION_COOKIE = 'sp_session';

export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Lax: the cookie is not sent on cross-site POSTs, which blocks CSRF on writes.
    sameSite: 'lax' as const,
    secure: getServerEnv().SESSION_COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookieOptions(new Date(0)), maxAge: 0 };
}
