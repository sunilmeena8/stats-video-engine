import {
  QUALITY_CHECK_IDS,
  QUALITY_STATUSES,
  type QualityCheck,
  type QualityReport,
} from '@statsopedia/shared-types';
import { z } from 'zod';

export const qualityCheckSchema = z.object({
  id: z.enum(QUALITY_CHECK_IDS),
  status: z.enum(QUALITY_STATUSES),
  title: z.string().min(1).max(200),
  detail: z.string().max(2_000),
}) satisfies z.ZodType<QualityCheck>;

export const qualityReportSchema = z.object({
  status: z.enum(QUALITY_STATUSES),
  checks: z.array(qualityCheckSchema),
}) satisfies z.ZodType<QualityReport>;
