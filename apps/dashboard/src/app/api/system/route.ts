import { NextResponse } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { readSessionToken } from '@/lib/server/session';
import { probeService } from '@/lib/service-health';

export const dynamic = 'force-dynamic';

/** Health of the services the dashboard depends on (signed-in users only). */
export async function GET(): Promise<Response> {
  if (!(await readSessionToken())) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } },
      { status: 401 },
    );
  }
  const env = getServerEnv();
  const options = { timeoutMs: env.HEALTH_PROBE_TIMEOUT_MS };
  const [api, processor] = await Promise.all([
    probeService(new URL('/health/ready', env.API_BASE_URL).toString(), options),
    probeService(new URL('/health/ready', env.DATA_PROCESSOR_BASE_URL).toString(), options),
  ]);
  return NextResponse.json(
    {
      services: [
        { name: 'API', probe: api },
        { name: 'Data processor', probe: processor },
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
