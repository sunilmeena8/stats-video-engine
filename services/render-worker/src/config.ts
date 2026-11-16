import path from 'node:path';

import { LOG_LEVELS, parseEnv } from '@statsopedia/utils/node';
import { z } from 'zod';

const absolutePath = (fallback: string) =>
  z
    .string()
    .min(1)
    .default(fallback)
    .transform((value) => path.resolve(value));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'REDIS_URL must be a redis:// connection URL' }),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'DATABASE_URL must be a postgres:// connection URL',
  }),
  STORAGE_ROOT: absolutePath('../../storage'),
  RENDERER_ENTRY_POINT: absolutePath('../../apps/renderer/src/index.ts'),
  /** Concurrent final renders (CPU-heavy; keep at 1 unless the machine has headroom). */
  RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** Concurrent preview renders, on their own queue so previews never wait behind finals. */
  PREVIEW_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** Browser tabs rendering frames of one video in parallel; unset lets Remotion choose. */
  REMOTION_CONCURRENCY: z.coerce.number().int().min(1).max(64).optional(),
  /** An attempt running longer than this is aborted and retried (as RENDER_TIMEOUT). */
  RENDER_TIMEOUT_MINUTES: z.coerce
    .number()
    .positive()
    .max(24 * 60)
    .default(60),
  PREVIEW_TIMEOUT_MINUTES: z.coerce
    .number()
    .positive()
    .max(24 * 60)
    .default(15),
  /** How long one frame may wait for fonts, images or audio to load. */
  FRAME_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
  /** Directory with ffmpeg/ffprobe; unset uses the binaries bundled with Remotion. */
  FFMPEG_BINARIES_DIR: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? path.resolve(value) : undefined)),
  /** Identifies this worker in logs and render metadata; defaults to hostname:pid. */
  WORKER_ID: z.string().trim().min(1).max(200).optional(),
  /** Job working directories older than this are removed at start-up. */
  TEMP_RETENTION_HOURS: z.coerce.number().positive().default(24),
  /** BullMQ key prefix; must match the API's. Leave unset outside tests. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /** A crashed worker's jobs are recovered after roughly this long (BullMQ lock duration). */
  LOCK_DURATION_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
  STALLED_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(600).default(30),
});

export type WorkerConfig = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  return parseEnv(configSchema, env);
}
