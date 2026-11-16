import {
  ANNOTATION_KINDS,
  ANNOTATION_POSITIONS,
  ANNOTATION_PRIORITIES,
  ANNOTATION_STYLES,
  EASING_NAMES,
  FPS_OPTIONS,
  OUTPUT_FORMATS,
  RESOLUTION_PRESETS,
  VALUE_SCALES,
  VALUE_STYLES,
  VIDEO_THEME_IDS,
  type BarChartRaceConfig,
  type EditorialAnnotation,
  type PublicRaceConfig,
  type PublicRaceMusic,
  type RaceMusic,
  type RaceTiming,
  type SourceReference,
  type ValueFormat,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { datasetPeriodSchema } from './dataset.js';
import { isSafeRelativePath } from './primitives.js';
import { normalizedDatasetSchema } from './processing.js';

export const RACE_TOP_N_MIN = 3;
export const RACE_TOP_N_MAX = 20;

/**
 * A file in the renderer's public directory, an http(s) URL, or an uploaded asset in storage as
 * `storage:assets/<path>` (the render worker serves those locally). Never an absolute path.
 */
export const mediaSourceSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      /^https?:\/\//.test(value) ||
      (value.startsWith('storage:assets/') && isSafeRelativePath(value.slice('storage:'.length))) ||
      (!/^[a-z]+:/i.test(value) && isSafeRelativePath(value)),
    'Must be an http(s) URL, a path inside the renderer public directory, or storage:assets/…',
  );

/** An uploaded image or logo in a project configuration, replaced by its file when rendering. */
export const MEDIA_REFERENCE_PATTERN =
  /^media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const imageSourceSchema = z.union([
  mediaSourceSchema,
  z.string().regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,/, 'Unsupported data URL'),
  z.string().regex(MEDIA_REFERENCE_PATTERN, 'Must be media:<asset id>'),
]);

export const valueFormatSchema = z
  .object({
    style: z.enum(VALUE_STYLES),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code such as USD')
      .nullable(),
    scale: z.enum(VALUE_SCALES),
    scaleLabel: z.enum(['short', 'long']),
    decimals: z.int().min(0).max(6).nullable(),
    percentInput: z.enum(['fraction', 'points']),
    prefix: z.string().max(12),
    suffix: z.string().max(24),
    locale: z.string().min(2).max(35),
  })
  .refine((format) => format.style !== 'currency' || format.currency !== null, {
    message: 'A currency is required when style is "currency"',
    path: ['currency'],
  })
  .refine(
    (format) => {
      try {
        new Intl.NumberFormat(format.locale);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown locale', path: ['locale'] },
  ) satisfies z.ZodType<ValueFormat>;

export const raceTimingSchema = z
  .object({
    secondsPerPeriod: z.number().min(0.2).max(30),
    transitionSeconds: z.number().min(0).max(30),
    easing: z.enum(EASING_NAMES),
    introSeconds: z.number().min(0).max(30),
    outroSeconds: z.number().min(0).max(30),
    finalHoldSeconds: z.number().min(0).max(30),
    creditsSeconds: z.number().min(0).max(30),
  })
  .refine((timing) => timing.transitionSeconds <= timing.secondsPerPeriod, {
    message: 'transitionSeconds cannot exceed secondsPerPeriod',
    path: ['transitionSeconds'],
  }) satisfies z.ZodType<RaceTiming>;

export const sourceReferenceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z
      .string()
      .trim()
      .max(2_048)
      .regex(/^https?:\/\/\S+$/, 'Must be an http(s) URL')
      .nullable(),
  })
  .strict() satisfies z.ZodType<SourceReference>;

/** Annotations shorter than this cannot be read. */
export const ANNOTATION_MIN_SECONDS = 1;

export const editorialAnnotationSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(ANNOTATION_KINDS),
    title: z.string().trim().min(1).max(80),
    text: z.string().trim().max(240).nullable(),
    icon: z.string().max(8).nullable(),
    imageUrl: imageSourceSchema.nullable(),
    sources: z.array(sourceReferenceSchema).max(5),
    timing: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('period'),
        period: datasetPeriodSchema,
        durationSeconds: z.number().min(ANNOTATION_MIN_SECONDS).max(60),
      }),
      z
        .object({
          kind: z.literal('time'),
          startSeconds: z.number().min(0).max(36_000),
          endSeconds: z.number().min(0).max(36_000),
        })
        .refine((timing) => timing.endSeconds - timing.startSeconds >= ANNOTATION_MIN_SECONDS, {
          message: `endSeconds must be at least ${ANNOTATION_MIN_SECONDS} s after startSeconds`,
          path: ['endSeconds'],
        }),
      z
        .object({ kind: z.literal('frames'), startFrame: z.int().min(0), endFrame: z.int().min(1) })
        .refine((timing) => timing.endFrame > timing.startFrame, {
          message: 'endFrame must be after startFrame',
          path: ['endFrame'],
        }),
    ]),
    priority: z.enum(ANNOTATION_PRIORITIES),
    style: z.enum(ANNOTATION_STYLES),
    position: z.enum(ANNOTATION_POSITIONS),
  })
  // Facts need citations; nothing is shown as fact without one.
  .refine((annotation) => annotation.kind === 'caption' || annotation.sources.length > 0, {
    message: 'Cite at least one source (only captions may have none)',
    path: ['sources'],
  }) satisfies z.ZodType<EditorialAnnotation>;

export const raceMusicSchema = z.object({
  src: mediaSourceSchema,
  volume: z.number().min(0).max(1),
  fadeInSeconds: z.number().min(0).max(30),
  fadeOutSeconds: z.number().min(0).max(30),
  loop: z.boolean(),
  durationSeconds: z.number().positive().nullable(),
  attribution: z.string().trim().min(1).max(300).nullable(),
}) satisfies z.ZodType<RaceMusic>;

const raceConfigObjectSchema = z.object({
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(160).nullable(),
  metricLabel: z.string().trim().max(120).nullable(),
  unitLabel: z.string().trim().max(60).nullable(),
  metricDescription: z.string().trim().max(200).nullable(),
  outputFormat: z.enum(OUTPUT_FORMATS),
  resolution: z.enum(RESOLUTION_PRESETS),
  fps: z.literal(FPS_OPTIONS),
  theme: z.enum(VIDEO_THEME_IDS),
  topN: z.int().min(RACE_TOP_N_MIN).max(RACE_TOP_N_MAX),
  startPeriod: datasetPeriodSchema.nullable(),
  endPeriod: datasetPeriodSchema.nullable(),
  timing: raceTimingSchema,
  valueFormat: valueFormatSchema,
  showLogos: z.boolean(),
  markEstimates: z.boolean(),
  sourceText: z.string().trim().max(200).nullable(),
  outroText: z.string().trim().max(200).nullable(),
  showSourceUrls: z.boolean(),
  annotations: z.array(editorialAnnotationSchema).max(20),
  music: raceMusicSchema.nullable(),
});

const hasUniqueAnnotationIds = (config: { annotations: { id: string }[] }) =>
  new Set(config.annotations.map((a) => a.id)).size === config.annotations.length;
const uniqueAnnotationIdsIssue = {
  message: 'Annotation ids must be unique',
  path: ['annotations'],
};

export const barChartRaceConfigSchema = raceConfigObjectSchema.refine(
  hasUniqueAnnotationIds,
  uniqueAnnotationIdsIssue,
) satisfies z.ZodType<BarChartRaceConfig>;

export const publicRaceMusicSchema = raceMusicSchema.omit({ src: true }).extend({
  downloadUrl: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}\/file$/),
}) satisfies z.ZodType<PublicRaceMusic>;

/** A race configuration as the API returns it: music is a download URL, never a storage key. */
export const publicRaceConfigSchema = raceConfigObjectSchema
  .extend({ music: publicRaceMusicSchema.nullable() })
  .refine(hasUniqueAnnotationIds, uniqueAnnotationIdsIssue) satisfies z.ZodType<PublicRaceConfig>;

/**
 * Input props of the BarChartRace composition. Periods named in the config must exist in the
 * dataset, so a typo fails validation instead of silently rendering the wrong range.
 */
export const barChartRacePropsSchema = z
  .object({ dataset: normalizedDatasetSchema, config: barChartRaceConfigSchema })
  .superRefine(({ dataset, config }, context) => {
    const periods = new Set(dataset.timeRange.periods);
    const check = (period: string | null, path: (string | number)[]) => {
      if (period !== null && !periods.has(period)) {
        context.addIssue({
          code: 'custom',
          message: `Period ${period} is not in the dataset`,
          path: ['config', ...path],
        });
      }
    };
    check(config.startPeriod, ['startPeriod']);
    check(config.endPeriod, ['endPeriod']);
    config.annotations.forEach((annotation, index) => {
      if (annotation.timing.kind === 'period') {
        check(annotation.timing.period, ['annotations', index, 'timing', 'period']);
      }
    });
    const { periods: all } = dataset.timeRange;
    if (
      config.startPeriod !== null &&
      config.endPeriod !== null &&
      all.indexOf(config.endPeriod) <= all.indexOf(config.startPeriod)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'endPeriod must come after startPeriod',
        path: ['config', 'endPeriod'],
      });
    }
  });

export const DEFAULT_VALUE_FORMAT: Readonly<ValueFormat> = {
  style: 'number',
  currency: null,
  scale: 'auto',
  scaleLabel: 'short',
  decimals: null,
  percentInput: 'fraction',
  prefix: '',
  suffix: '',
  locale: 'en-US',
};

export const DEFAULT_RACE_TIMING: Readonly<RaceTiming> = {
  secondsPerPeriod: 1.6,
  transitionSeconds: 1.2,
  easing: 'easeInOut',
  introSeconds: 3,
  outroSeconds: 3,
  finalHoldSeconds: 3,
  creditsSeconds: 0,
};
