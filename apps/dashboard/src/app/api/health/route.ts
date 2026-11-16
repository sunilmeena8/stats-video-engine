import type { HealthResponse } from '@statsopedia/shared-types';

import packageJson from '../../../../package.json' with { type: 'json' };

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

/** Dashboard liveness probe. Does not depend on any other service. */
export function GET(): Response {
  const body: HealthResponse = {
    status: 'ok',
    service: 'dashboard',
    version: packageJson.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    timestamp: new Date().toISOString(),
    checks: {},
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
