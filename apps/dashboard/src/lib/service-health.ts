import { healthResponseSchema } from '@statsopedia/shared-schemas';
import type { HealthResponse } from '@statsopedia/shared-types';
import { z } from 'zod';

/** Outcome of probing a service's health endpoint. Never throws. */
export type ServiceProbe =
  | { state: 'reachable'; httpStatus: number; health: HealthResponse }
  | { state: 'invalid-response'; httpStatus: number; error: string }
  | { state: 'unreachable'; error: string };

export interface ProbeOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Timed out after ${timeoutMs}ms`;
  }
  if (error instanceof Error) {
    const cause: unknown = error.cause;
    if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
      return cause.code === 'ECONNREFUSED'
        ? 'Connection refused (is the service running?)'
        : cause.code;
    }
    return error.message;
  }
  return String(error);
}

/**
 * Fetches a health endpoint and validates the body against the shared contract.
 * A 503 with a valid body is still "reachable": the service is up but reporting degraded.
 */
export async function probeService(url: string, options: ProbeOptions): Promise<ServiceProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    return { state: 'unreachable', error: describeFetchError(error, options.timeoutMs) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: 'invalid-response', httpStatus: response.status, error: 'Body is not JSON' };
  }

  const parsed = healthResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      state: 'invalid-response',
      httpStatus: response.status,
      error: z.prettifyError(parsed.error),
    };
  }
  return { state: 'reachable', httpStatus: response.status, health: parsed.data };
}
