import type { Timestamps, Uuid } from './common.js';
import type { DatasetPeriod } from './dataset.js';
import type { EditorialAnnotation, ValueFormat } from './race.js';

/** `long` = 16:9 long-form YouTube video, `short` = 9:16 YouTube Short. */
export const OUTPUT_FORMATS = ['long', 'short'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Named resolution tiers. The short edge is the tier height (e.g. 1080p → 1920x1080 / 1080x1920). */
export const RESOLUTION_PRESETS = ['720p', '1080p', '1440p', '2160p'] as const;
export type ResolutionPreset = (typeof RESOLUTION_PRESETS)[number];

export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
export type Fps = (typeof FPS_OPTIONS)[number];

export const ANIMATION_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];

export const VIDEO_THEME_IDS = ['midnight', 'graphite', 'daylight'] as const;
export type VideoThemeId = (typeof VIDEO_THEME_IDS)[number];

export const VIDEO_PROJECT_STATUSES = [
  'draft',
  'ready',
  'rendering',
  'rendered',
  'failed',
  'archived',
] as const;
export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export interface IntroConfiguration {
  enabled: boolean;
  durationSeconds: number;
  /** Falls back to the video title when null. */
  title: string | null;
  subtitle: string | null;
}

export interface OutroConfiguration {
  enabled: boolean;
  durationSeconds: number;
  /** Call-to-action text, e.g. "Subscribe for more rankings". */
  text: string | null;
}

export interface MusicConfiguration {
  /** MediaAsset of type `music`. */
  assetId: Uuid;
  /** Linear gain, 0 (muted) to 1 (full). Never above 1, so music is never amplified. */
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /**
   * Repeat the track (with crossfades) when it is shorter than the video. When false, a track
   * shorter than the video cannot be rendered: loop it or choose a longer one.
   */
  loop: boolean;
}

/** The closing source credits scene. */
export interface CreditsConfiguration {
  enabled: boolean;
  durationSeconds: number;
  /** List source URLs as well as names. */
  showUrls: boolean;
}

/** Which videos a project produces: one long-form, one Short, or both from the same data. */
export const OUTPUT_MODES = ['long', 'short', 'both'] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

/**
 * Everything needed to turn a dataset version into videos. Validated by
 * `videoConfigurationSchema`; turned into the renderer's per-format `BarChartRaceConfig` by
 * `buildRaceConfig` in `@statsopedia/video-config`.
 */
export interface VideoConfiguration {
  /** YouTube title (max 100 characters); also the on-screen title. */
  title: string;
  /** YouTube description (max 5000 characters). */
  description: string;
  /** The immutable dataset version the video is built from. */
  datasetVersionId: Uuid;
  templateId: Uuid;
  /** First and last period to animate (null = the dataset's first / last period). */
  startPeriod: DatasetPeriod | null;
  endPeriod: DatasetPeriod | null;
  /** Number of entities visible in the ranking at once. */
  topN: number;
  animationSpeed: AnimationSpeed;
  theme: VideoThemeId;
  outputMode: OutputMode;
  music: MusicConfiguration | null;
  fps: Fps;
  resolution: ResolutionPreset;
  intro: IntroConfiguration;
  /** Final ranking, winner and end card. */
  outro: OutroConfiguration;
  credits: CreditsConfiguration;
  /** On-screen metric name; defaults to the dataset title. */
  metricLabel: string | null;
  /** One sentence on what is measured, shown on the intro; defaults to the dataset description. */
  metricDescription: string | null;
  /** On-screen unit; defaults to the dataset unit. */
  unitLabel: string | null;
  valueFormat: ValueFormat;
  showLogos: boolean;
  markEstimates: boolean;
  /** Compact on-screen source label; overrides the one built from the dataset's sources. */
  sourceText: string | null;
  annotations: EditorialAnnotation[];
}

/**
 * A reusable video layout backed by a Remotion composition. Template rows are immutable: a
 * change is published as a new `version` of the same `slug`, and projects record the version
 * they were built with.
 */
export interface VideoTemplate extends Timestamps {
  id: Uuid;
  slug: string;
  version: number;
  name: string;
  description: string | null;
  /** Remotion composition id rendered for this template. */
  compositionId: string;
  supportedFormats: OutputFormat[];
  isActive: boolean;
}

/** A user's working video: one configuration that can be previewed and rendered many times. */
export interface VideoProject extends Timestamps {
  id: Uuid;
  /** Internal working name; the published title lives in the configuration. */
  name: string;
  topicId: Uuid | null;
  status: VideoProjectStatus;
  datasetId: Uuid;
  /** Mirrors configuration.datasetVersionId: always one specific, immutable version. */
  datasetVersionId: Uuid;
  templateId: Uuid;
  templateVersion: number;
  configuration: VideoConfiguration;
  /** Incremented on every update; PUT must send the current value (optimistic locking). */
  revision: number;
  createdBy: Uuid | null;
}
