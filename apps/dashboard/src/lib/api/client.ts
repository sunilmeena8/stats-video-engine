import { z } from 'zod';

/** A failed API call, with the API's error code, message and validation issues. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: unknown = undefined,
  ) {
    super(message);
  }

  /** Validation issues as `path: message` lines, when the API sent them. */
  get details(): string[] {
    const parsed = z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])).optional(),
          message: z.string(),
        }),
      )
      .safeParse(this.issues);
    return parsed.success
      ? parsed.data.map((issue) =>
          issue.path?.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        )
      : [];
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), issues: z.unknown().optional() }),
});

/** Base path of the dashboard's API proxy (see app/api/backend). */
export const BACKEND = '/api/backend';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as-is (files). */
  body?: BodyInit;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function withQuery(path: string, query: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** Sends the visitor to sign-in, returning here afterwards. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  const next = window.location.pathname + window.location.search;
  // Outside React (any failed call): a full navigation to sign-in.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function send(url: string, { json, body, query, headers, ...init }: RequestOptions) {
  let response: Response;
  try {
    response = await fetch(withQuery(url, query), {
      ...init,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The dashboard server is not reachable');
  }
  if (response.ok) return response;
  const payload: unknown = await response.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(payload);
  const error = parsed.success
    ? new ApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.issues,
      )
    : new ApiError(response.status, 'HTTP_ERROR', `Request failed (HTTP ${response.status})`);
  if (response.status === 401) redirectToLogin();
  throw error;
}

/**
 * Calls the API through the dashboard proxy and validates the response against the shared
 * contract, so every screen works with the same types as the API.
 */
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(`${BACKEND}${path}`, options);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      `Unexpected response from ${path}`,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/** A call whose response body is not used (204s). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await send(`${BACKEND}${path}`, options);
}

/** Same-origin URL of a backend resource (downloads, media, event streams). */
export function backendUrl(path: string): string {
  return `${BACKEND}${path}`;
}

/** Calls a dashboard route (not proxied), e.g. the session endpoint. */
export async function local<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options);
  return schema.parse(await response.json());
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
