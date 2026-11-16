import {
  DEPENDENCY_STATUSES,
  HEALTH_STATUSES,
  type DependencyCheckResult,
  type HealthResponse,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { isoDateTimeSchema } from './primitives.js';

export const dependencyCheckResultSchema = z.object({
  status: z.enum(DEPENDENCY_STATUSES),
  latencyMs: z.number().nonnegative(),
  error: z.string().nullable(),
}) satisfies z.ZodType<DependencyCheckResult>;

export const healthResponseSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
  checks: z.record(z.string(), dependencyCheckResultSchema),
}) satisfies z.ZodType<HealthResponse>;
