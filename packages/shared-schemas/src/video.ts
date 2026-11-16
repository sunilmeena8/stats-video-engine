import {
  ANIMATION_SPEEDS,
  FPS_OPTIONS,
  OUTPUT_FORMATS,
  OUTPUT_MODES,
  RESOLUTION_PRESETS,
  VIDEO_PROJECT_STATUSES,
  VIDEO_THEME_IDS,
  type CreditsConfiguration,
  type IntroConfiguration,
  type MusicConfiguration,
  type OutroConfiguration,
  type VideoConfiguration,
  type VideoProject,
  type VideoTemplate,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { datasetPeriodSchema } from './dataset.js';
import { slugSchema, timestampsShape, uuidSchema } from './primitives.js';
import { editorialAnnotationSchema, valueFormatSchema } from './race.js';

/** YouTube's hard limits. */
export const VIDEO_TITLE_MAX_LENGTH = 100;
export const VIDEO_DESCRIPTION_MAX_LENGTH = 5_000;

export const TOP_N_MIN = 3;
/** The bar chart race shows at most 20 rows (RACE_TOP_N_MAX). */
export const TOP_N_MAX = 20;
export const BOOKEND_MAX_SECONDS = 30;

export const compositionIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/, 'Remotion composition ids may only contain a-z, A-Z, 0-9 and "-"');

export const outputFormatSchema = z.enum(OUTPUT_FORMATS);

const bookendDurationSchema = z.number().min(0).max(BOOKEND_MAX_SECONDS);

export const introConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    durationSeconds: bookendDurationSchema,
    title: z.string().trim().min(1).max(120).nullable(),
    subtitle: z.string().trim().min(1).max(200).nullable(),
  })
  .refine((intro) => !intro.enabled || intro.durationSeconds > 0, {
    message: 'durationSeconds must be greater than 0 when the intro is enabled',
    path: ['durationSeconds'],
  }) satisfies z.ZodType<IntroConfiguration>;

export const outroConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    durationSeconds: bookendDurationSchema,
    text: z.string().trim().min(1).max(200).nullable(),
  })
  .refine((outro) => !outro.enabled || outro.durationSeconds > 0, {
    message: 'durationSeconds must be greater than 0 when the outro is enabled',
    path: ['durationSeconds'],
  }) satisfies z.ZodType<OutroConfiguration>;

export const musicConfigurationSchema = z.object({
  assetId: uuidSchema,
  volume: z.number().min(0).max(1),
  fadeInSeconds: z.number().min(0).max(30),
  fadeOutSeconds: z.number().min(0).max(30),
  loop: z.boolean(),
}) satisfies z.ZodType<MusicConfiguration>;

export const creditsConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    durationSeconds: bookendDurationSchema,
    showUrls: z.boolean(),
  })
  .refine((credits) => !credits.enabled || credits.durationSeconds >= 2, {
    message: 'The credits scene needs at least 2 seconds to be read',
    path: ['durationSeconds'],
  }) satisfies z.ZodType<CreditsConfiguration>;

export const outputModeSchema = z.enum(OUTPUT_MODES);

/** The shared video configuration schema. Defaults and presets live in `@statsopedia/video-config`. */
export const videoConfigurationSchema = z
  .object({
    title: z.string().trim().min(1).max(VIDEO_TITLE_MAX_LENGTH),
    description: z.string().max(VIDEO_DESCRIPTION_MAX_LENGTH),
    datasetVersionId: uuidSchema,
    templateId: uuidSchema,
    startPeriod: datasetPeriodSchema.nullable(),
    endPeriod: datasetPeriodSchema.nullable(),
    topN: z.int().min(TOP_N_MIN).max(TOP_N_MAX),
    animationSpeed: z.enum(ANIMATION_SPEEDS),
    theme: z.enum(VIDEO_THEME_IDS),
    outputMode: outputModeSchema,
    music: musicConfigurationSchema.nullable(),
    fps: z.literal(FPS_OPTIONS),
    resolution: z.enum(RESOLUTION_PRESETS),
    intro: introConfigurationSchema,
    outro: outroConfigurationSchema,
    credits: creditsConfigurationSchema,
    metricLabel: z.string().trim().max(120).nullable(),
    metricDescription: z.string().trim().max(200).nullable(),
    unitLabel: z.string().trim().max(60).nullable(),
    valueFormat: valueFormatSchema,
    showLogos: z.boolean(),
    markEstimates: z.boolean(),
    sourceText: z.string().trim().max(200).nullable(),
    annotations: z.array(editorialAnnotationSchema).max(20),
  })
  .strict() satisfies z.ZodType<VideoConfiguration>;

export const videoTemplateSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  version: z.int().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  compositionId: compositionIdSchema,
  supportedFormats: z.array(outputFormatSchema).min(1),
  isActive: z.boolean(),
  ...timestampsShape,
}) satisfies z.ZodType<VideoTemplate>;

export const projectNameSchema = z.string().trim().min(1).max(200);

export const videoProjectSchema = z.object({
  id: uuidSchema,
  name: projectNameSchema,
  topicId: uuidSchema.nullable(),
  status: z.enum(VIDEO_PROJECT_STATUSES),
  datasetId: uuidSchema,
  datasetVersionId: uuidSchema,
  templateId: uuidSchema,
  templateVersion: z.int().min(1),
  configuration: videoConfigurationSchema,
  revision: z.int().min(1),
  createdBy: uuidSchema.nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<VideoProject>;
