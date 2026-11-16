import type { BarChartRaceConfig, NormalizedDataset } from '@statsopedia/shared-types';

import { resolveDimensions } from './dimensions.js';
import { computeRaceTimeline, type RaceTimeline } from './race-timeline.js';

export interface RaceRenderPlan {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Last chart frame (just before the outro): the video's thumbnail. */
  thumbnailFrame: number;
  timeline: RaceTimeline;
}

/** Number of periods the race animates, respecting its start and end period. */
export function racePeriodCount(
  periods: readonly string[],
  config: Pick<BarChartRaceConfig, 'startPeriod' | 'endPeriod'>,
): number {
  const start = config.startPeriod === null ? 0 : periods.indexOf(config.startPeriod);
  const end = config.endPeriod === null ? periods.length - 1 : periods.indexOf(config.endPeriod);
  if (start < 0 || end < 0) throw new RangeError('Start or end period is not in the dataset');
  return end - start + 1;
}

/**
 * Size, frame rate and frame count of a race render. The composition's `calculateMetadata`, the
 * API (before queueing) and the render worker (before rendering) all use this, so they agree.
 */
export function planRaceRender({
  dataset,
  config,
}: {
  dataset: Pick<NormalizedDataset, 'timeRange'>;
  config: BarChartRaceConfig;
}): RaceRenderPlan {
  const { width, height } = resolveDimensions(config.outputFormat, config.resolution);
  const timeline = computeRaceTimeline(config.timing, {
    fps: config.fps,
    periodCount: racePeriodCount(dataset.timeRange.periods, config),
  });
  return {
    width,
    height,
    fps: config.fps,
    durationInFrames: timeline.durationInFrames,
    thumbnailFrame: Math.max(0, timeline.outroStartFrame - 1),
    timeline,
  };
}
