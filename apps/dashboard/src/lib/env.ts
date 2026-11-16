import { z } from 'zod';

const serverEnvSchema = z.object({
  API_BASE_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:4000'),
  DATA_PROCESSOR_BASE_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:8000'),
  HEALTH_PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_500),
  /**
   * Send the session cookie over HTTPS only. Defaults to on in production; turn it off only
   * for a local production build served over plain HTTP.
   */
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) =>
      value === undefined ? process.env.NODE_ENV === 'production' : value === 'true',
    ),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

/** Server-only configuration. Throws with every invalid variable listed. */
export function getServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = serverEnvSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid dashboard environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
