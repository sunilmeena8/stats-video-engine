import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic route protection: pages need a session cookie, or they redirect to sign-in. The
 * cookie is verified for real by the dashboard layout (and every API call); this only avoids
 * rendering protected pages for visitors who are obviously signed out.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has('sp_session')) return NextResponse.next();
  const login = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except sign-in, API routes, Next.js assets and static files.
  matcher: ['/((?!login|api/|_next/|favicon|icon|fonts/|.*\\.[a-z0-9]+$).*)'],
};
