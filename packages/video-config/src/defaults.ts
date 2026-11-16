import { DEFAULT_VALUE_FORMAT, videoConfigurationSchema } from '@statsopedia/shared-schemas';
import type {
  CreditsConfiguration,
  IntroConfiguration,
  OutputFormat,
  OutputMode,
  OutroConfiguration,
  VideoConfiguration,
} from '@statsopedia/shared-types';

/** Fields every configuration must provide explicitly; everything else has a default. */
type RequiredField = 'title' | 'datasetVersionId' | 'templateId';

export type VideoConfigurationDefaults = Omit<VideoConfiguration, RequiredField>;

export type VideoConfigurationInput = Pick<VideoConfiguration, RequiredField> &
  Partial<Omit<VideoConfigurationDefaults, 'intro' | 'outro' | 'credits'>> & {
    intro?: Partial<IntroConfiguration>;
    outro?: Partial<OutroConfiguration>;
    credits?: Partial<CreditsConfiguration>;
  };

export const DEFAULT_VIDEO_CONFIGURATION: Readonly<VideoConfigurationDefaults> = {
  description: '',
  startPeriod: null,
  endPeriod: null,
  topN: 10,
  animationSpeed: 'normal',
  theme: 'midnight',
  outputMode: 'long',
  music: null,
  fps: 30,
  resolution: '1080p',
  intro: { enabled: true, durationSeconds: 3, title: null, subtitle: null },
  outro: { enabled: true, durationSeconds: 4, text: null },
  credits: { enabled: true, durationSeconds: 4, showUrls: false },
  metricLabel: null,
  metricDescription: null,
  unitLabel: null,
  valueFormat: DEFAULT_VALUE_FORMAT,
  showLogos: true,
  markEstimates: true,
  sourceText: null,
  annotations: [],
};

/**
 * Builds a complete configuration from the required fields plus optional overrides, then
 * validates it. Throws a ZodError when the result is invalid.
 */
export function createVideoConfiguration(input: VideoConfigurationInput): VideoConfiguration {
  return videoConfigurationSchema.parse({
    ...DEFAULT_VIDEO_CONFIGURATION,
    ...input,
    intro: { ...DEFAULT_VIDEO_CONFIGURATION.intro, ...input.intro },
    outro: { ...DEFAULT_VIDEO_CONFIGURATION.outro, ...input.outro },
    credits: { ...DEFAULT_VIDEO_CONFIGURATION.credits, ...input.credits },
  });
}

/** The formats an output mode produces, in a stable order. */
export function formatsForMode(mode: OutputMode): OutputFormat[] {
  return mode === 'both' ? ['long', 'short'] : [mode];
}
