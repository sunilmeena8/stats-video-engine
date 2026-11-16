import path from 'node:path';

import { LOG_LEVELS, parseEnv } from '@statsopedia/utils/node';
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // Credentials live only in the environment; there are deliberately no defaults.
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'DATABASE_URL must be a postgres:// connection URL',
  }),
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'REDIS_URL must be a redis:// connection URL' }),
  STORAGE_ROOT: z
    .string()
    .min(1)
    .default('../../storage')
    .transform((value) => path.resolve(value)),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  // Internal service; not a credential, so a local default is fine.
  DATA_PROCESSOR_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:8000'),
  DATA_PROCESSOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(500 * 1024 * 1024)
    .default(50 * 1024 * 1024),
  MAX_MEDIA_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(500 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(600),
  UPLOADS_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(120),
  /** Run the render job monitor in this instance (enable in exactly one API instance). */
  JOB_MONITOR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type ApiConfig = z.output<typeof configSchema>;

/** Parses and validates the API environment. Throws ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  return parseEnv(configSchema, env);
}
