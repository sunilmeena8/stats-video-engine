import type { DatasetPeriod } from './dataset.js';
import type { NormalizedDataset } from './processing.js';
import type { Fps, OutputFormat, ResolutionPreset, VideoThemeId } from './video.js';

// ─── Number formatting ───────────────────────────────────────────────────────────────────────

export const VALUE_STYLES = ['number', 'integer', 'percent', 'currency'] as const;
export type ValueStyle = (typeof VALUE_STYLES)[number];

export const VALUE_SCALES = [
  'none',
  'auto',
  'thousands',
  'millions',
  'billions',
  'trillions',
] as const;
/** `auto` picks K/M/B/T from each value's magnitude. */
export type ValueScale = (typeof VALUE_SCALES)[number];

/** How on-screen values are written. Pure data, so it can be stored and sent between services. */
export interface ValueFormat {
  style: ValueStyle;
  /** ISO 4217 code, required when `style` is `currency` (e.g. `USD`, `EUR`, `JPY`). */
  currency: string | null;
  scale: ValueScale;
  /** `short`: 1.2B. `long`: 1.2 billion. */
  scaleLabel: 'short' | 'long';
  /** Fraction digits; null picks them from the magnitude (fixed per value, so counters don't jitter). */
  decimals: number | null;
  /** For `percent`: is 0.25 or 25 "25%"? */
  percentInput: 'fraction' | 'points';
  /** Custom units, e.g. prefix `≈ ` or suffix ` t CO₂`. */
  prefix: string;
  suffix: string;
  /** BCP 47 locale for separators, e.g. `en-US`, `de-DE`, `en-IN`. */
  locale: string;
}

// ─── Bar chart race ──────────────────────────────────────────────────────────────────────────

export const EASING_NAMES = ['linear', 'easeInOut', 'easeOut', 'easeInOutSine'] as const;
export type EasingName = (typeof EASING_NAMES)[number];

export interface RaceTiming {
  /** Time spent on each period, including its transition to the next. */
  secondsPerPeriod: number;
  /** Part of `secondsPerPeriod` spent moving to the next period (the rest holds still). */
  transitionSeconds: number;
  easing: EasingName;
  introSeconds: number;
  /** Final ranking and end card. */
  outroSeconds: number;
  /** How long the final period stays on screen before the outro. */
  finalHoldSeconds: number;
  /** Source credits scene after the outro (0 = none). */
  creditsSeconds: number;
}

export const ANNOTATION_STYLES = ['card', 'callout', 'banner'] as const;
export type AnnotationStyle = (typeof ANNOTATION_STYLES)[number];

/**
 * What an annotation says. Every kind except `caption` states a fact, so it must cite at least
 * one source. Data-driven kinds (`ranking_change`, `winner`, `top_entry`, `value_change`) are
 * suggested from the dataset itself; `milestone` (a historical event) is always written by an
 * editor: nothing invents events.
 */
export const ANNOTATION_KINDS = [
  'milestone',
  'ranking_change',
  'winner',
  'top_entry',
  'value_change',
  'caption',
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Which annotation keeps its slot when two would be on screen at once. */
export const ANNOTATION_PRIORITIES = ['low', 'normal', 'high'] as const;
export type AnnotationPriority = (typeof ANNOTATION_PRIORITIES)[number];

/** `auto` picks the corner that covers the least of the bars while the note is shown. */
export const ANNOTATION_POSITIONS = [
  'auto',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
export type AnnotationPosition = (typeof ANNOTATION_POSITIONS)[number];

/** A citation: a publication or organisation, and optionally where to find it. */
export interface SourceReference {
  name: string;
  url: string | null;
}

/**
 * When an annotation is shown: anchored to a period (from the moment it is reached), a time
 * range in seconds from the start of the video, or explicit composition frames.
 */
export type AnnotationTiming =
  | { kind: 'period'; period: DatasetPeriod; durationSeconds: number }
  | { kind: 'time'; startSeconds: number; endSeconds: number }
  | { kind: 'frames'; startFrame: number; endFrame: number };

/** An editorial note shown over the chart, e.g. a historical milestone. */
export interface EditorialAnnotation {
  id: string;
  kind: AnnotationKind;
  title: string;
  text: string | null;
  /** A short glyph shown beside the title (an emoji or a symbol like ▲). */
  icon: string | null;
  /**
   * http(s) or data: URL, a file in the renderer's public directory, or an uploaded image. In
   * a project an upload is `media:<asset id>`; `buildRaceConfig` turns it into its file.
   */
  imageUrl: string | null;
  /** Required (at least one) for every kind except `caption`. */
  sources: SourceReference[];
  timing: AnnotationTiming;
  priority: AnnotationPriority;
  style: AnnotationStyle;
  position: AnnotationPosition;
}

/**
 * Background music as the composition sees it. Licensing metadata is deliberately absent: it is
 * kept outside the composition, in the render manifest and the sidecar written next to the video.
 */
export interface RaceMusic {
  /**
   * File in the renderer's public directory (e.g. `audio/pad.wav`), an http(s) URL, or an
   * uploaded asset as `storage:assets/music/<file>` (resolved by the render worker).
   */
  src: string;
  /** 0–1. Never above 1, so the track is not amplified (and cannot clip from gain). */
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /**
   * Repeat a short track (crossfading each repeat) so the audio lasts as long as the video.
   * When false, a track shorter than the video is refused by the quality checks.
   */
  loop: boolean;
  /** Length of the track; null for tracks uploaded before durations were measured. */
  durationSeconds: number | null;
  /** Credit line shown in the video when the license requires attribution. */
  attribution: string | null;
}

/** Everything about how a dataset is rendered as a bar chart race. */
export interface BarChartRaceConfig {
  title: string;
  subtitle: string | null;
  /** Defaults to the dataset title. */
  metricLabel: string | null;
  /** Defaults to the dataset unit. */
  unitLabel: string | null;
  /** One sentence on what is measured, shown on the intro (defaults to the dataset description). */
  metricDescription: string | null;
  outputFormat: OutputFormat;
  resolution: ResolutionPreset;
  fps: Fps;
  theme: VideoThemeId;
  topN: number;
  /** Render a sub-range of the dataset's periods (inclusive). */
  startPeriod: DatasetPeriod | null;
  endPeriod: DatasetPeriod | null;
  timing: RaceTiming;
  valueFormat: ValueFormat;
  showLogos: boolean;
  /** Mark values the data-processor estimated (bridged gaps) with "est.". */
  markEstimates: boolean;
  /** Overrides the source line built from the dataset's sources. */
  sourceText: string | null;
  /** Closing line on the end card (e.g. a call to action). */
  outroText: string | null;
  /** Show source URLs (not just names) in the credits scene. */
  showSourceUrls: boolean;
  annotations: EditorialAnnotation[];
  music: RaceMusic | null;
}

/** Music as clients see it in a render manifest: the internal source becomes a download URL. */
export interface PublicRaceMusic extends Omit<RaceMusic, 'src'> {
  /** API path of the uploaded track, e.g. `/api/media/<id>/file`. */
  downloadUrl: string;
}

/** A race configuration as returned by the API; it never contains storage references. */
export interface PublicRaceConfig extends Omit<BarChartRaceConfig, 'music'> {
  music: PublicRaceMusic | null;
}

/** Input props of the BarChartRace composition. */
export interface BarChartRaceProps {
  dataset: NormalizedDataset;
  config: BarChartRaceConfig;
}
