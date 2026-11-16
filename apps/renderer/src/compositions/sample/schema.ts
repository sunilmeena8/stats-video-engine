import {
  ANIMATION_SPEEDS,
  FPS_OPTIONS,
  OUTPUT_FORMATS,
  RESOLUTION_PRESETS,
  VIDEO_THEME_IDS,
} from '@statsopedia/shared-types';
import { computeTimeline, resolveDimensions, type VideoTimeline } from '@statsopedia/video-config';
import { z } from 'zod';

import { SAMPLE_END_YEAR, SAMPLE_ENTITIES, SAMPLE_START_YEAR } from './sample-data';

/** Input props of the sample composition. Validated in `calculateMetadata` before rendering. */
export const sampleCompositionPropsSchema = z.object({
  outputFormat: z.enum(OUTPUT_FORMATS),
  resolution: z.enum(RESOLUTION_PRESETS),
  fps: z.literal(FPS_OPTIONS),
  theme: z.enum(VIDEO_THEME_IDS),
  animationSpeed: z.enum(ANIMATION_SPEEDS),
  topN: z.int().min(3).max(SAMPLE_ENTITIES.length),
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(200),
});

export type SampleCompositionProps = z.output<typeof sampleCompositionPropsSchema>;

export const INTRO_SECONDS = 2.5;
export const OUTRO_SECONDS = 2.5;

export function buildSampleTimeline(props: SampleCompositionProps): VideoTimeline {
  return computeTimeline({
    fps: props.fps,
    startYear: SAMPLE_START_YEAR,
    endYear: SAMPLE_END_YEAR,
    animationSpeed: props.animationSpeed,
    intro: { enabled: true, durationSeconds: INTRO_SECONDS, title: null, subtitle: null },
    outro: { enabled: true, durationSeconds: OUTRO_SECONDS, text: null },
  });
}

/** Validates props and derives the composition's size, frame rate and duration from them. */
export function resolveSampleMetadata(rawProps: unknown) {
  const props = sampleCompositionPropsSchema.parse(rawProps);
  const { width, height } = resolveDimensions(props.outputFormat, props.resolution);
  const { durationInFrames } = buildSampleTimeline(props);
  return { props, width, height, fps: props.fps, durationInFrames };
}
