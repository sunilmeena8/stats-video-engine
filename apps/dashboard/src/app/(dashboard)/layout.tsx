import { userSchema } from '@statsopedia/shared-schemas';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ReactNode } from 'react';

import { Shell } from '@/components/shell/Shell';
import { getServerEnv } from '@/lib/env';
import { readSessionToken } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Every dashboard page is behind a session. The cookie is checked against the API here, so an
 * expired or revoked session goes back to sign-in instead of rendering an empty dashboard.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/me', getServerEnv().API_BASE_URL), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return <Unavailable />;
  }
  if (response.status === 401) redirect('/login?expired=1');
  if (!response.ok) return <Unavailable />;
  const { user } = z.object({ user: userSchema }).parse(await response.json());
  return <Shell user={user}>{children}</Shell>;
}

function Unavailable() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>The Statsopedia API is not reachable</h1>
        <p style={{ color: 'var(--sp-color-text-secondary)', margin: 0 }}>
          Start it with <code>pnpm dev:api</code> and reload this page.
        </p>
      </div>
    </main>
  );
}
