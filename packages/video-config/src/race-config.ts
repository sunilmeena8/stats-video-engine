import { MEDIA_REFERENCE_PATTERN, barChartRaceConfigSchema } from '@statsopedia/shared-schemas';
import type {
  BarChartRaceConfig,
  OutputFormat,
  RenderKind,
  VideoConfiguration,
} from '@statsopedia/shared-types';

import { safeMusicGain, type ResolvedMusic } from './music.js';
import { SECONDS_PER_YEAR } from './timeline.js';

/** Previews trade resolution for speed; everything else matches the final render. */
export const PREVIEW_RESOLUTION = '720p';
/** Share of each period spent moving to the next one (the rest holds still). */
export const TRANSITION_SHARE = 0.8;
export const FINAL_HOLD_SECONDS = 3;

export interface RaceConfigOptions {
  format: OutputFormat;
  kind: RenderKind;
  /**
   * The project's music asset, resolved (see `resolveMusicAsset`), or null. Only what the
   * composition needs enters it: the source, the length, and the credit line when required.
   */
  music: ResolvedMusic | null;
  /**
   * Sources of the uploaded images annotations refer to as `media:<id>`, by asset id
   * (`storage:assets/…` for renders, a URL in the Studio). A missing one is an error.
   */
  images?: Readonly<Record<string, string>>;
}

/** Asset ids of the uploaded images a configuration's annotations use. */
export function referencedImageAssets(configuration: Pick<VideoConfiguration, 'annotations'>) {
  return [
    ...new Set(
      configuration.annotations.flatMap(
        (annotation) => MEDIA_REFERENCE_PATTERN.exec(annotation.imageUrl ?? '')?.[1] ?? [],
      ),
    ),
  ];
}

/**
 * Turns a project's `VideoConfiguration` into the renderer's `BarChartRaceConfig` for one
 * output format. The only place this mapping lives, so the API, the dashboard and tests agree.
 */
export function buildRaceConfig(
  configuration: VideoConfiguration,
  { format, kind, music: resolved, images = {} }: RaceConfigOptions,
): BarChartRaceConfig {
  const annotations = configuration.annotations.map((annotation) => {
    const assetId = MEDIA_REFERENCE_PATTERN.exec(annotation.imageUrl ?? '')?.[1];
    if (!assetId) return annotation;
    const src = images[assetId];
    if (!src)
      throw new RangeError(`Image ${assetId} of annotation "${annotation.id}" is not available`);
    return { ...annotation, imageUrl: src };
  });
  const secondsPerPeriod = SECONDS_PER_YEAR[configuration.animationSpeed];
  const music =
    configuration.music && resolved
      ? {
          src: resolved.src,
          // Turned down when the track is mastered too hot to play at this volume unclipped.
          volume: Math.min(configuration.music.volume, safeMusicGain(resolved.truePeakDbtp)),
          fadeInSeconds: configuration.music.fadeInSeconds,
          fadeOutSeconds: configuration.music.fadeOutSeconds,
          loop: configuration.music.loop,
          durationSeconds: resolved.durationSeconds,
          attribution: resolved.attribution,
        }
      : null;
  return barChartRaceConfigSchema.parse({
    title: configuration.intro.title ?? configuration.title,
    subtitle: configuration.intro.subtitle,
    metricLabel: configuration.metricLabel,
    unitLabel: configuration.unitLabel,
    metricDescription: configuration.metricDescription,
    outputFormat: format,
    resolution: kind === 'preview' ? PREVIEW_RESOLUTION : configuration.resolution,
    fps: configuration.fps,
    theme: configuration.theme,
    topN: configuration.topN,
    startPeriod: configuration.startPeriod,
    endPeriod: configuration.endPeriod,
    timing: {
      secondsPerPeriod,
      transitionSeconds: Math.round(secondsPerPeriod * TRANSITION_SHARE * 100) / 100,
      easing: 'easeInOut',
      introSeconds: configuration.intro.enabled ? configuration.intro.durationSeconds : 0,
      outroSeconds: configuration.outro.enabled ? configuration.outro.durationSeconds : 0,
      finalHoldSeconds: FINAL_HOLD_SECONDS,
      creditsSeconds: configuration.credits.enabled ? configuration.credits.durationSeconds : 0,
    },
    valueFormat: configuration.valueFormat,
    showLogos: configuration.showLogos,
    markEstimates: configuration.markEstimates,
    sourceText: configuration.sourceText,
    outroText: configuration.outro.text,
    showSourceUrls: configuration.credits.showUrls,
    annotations,
    music,
  });
}
