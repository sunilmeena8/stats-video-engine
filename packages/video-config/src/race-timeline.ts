import type { EasingName, RaceTiming } from '@statsopedia/shared-types';

import { ease } from './easing.js';

/**
 * Frame layout of a bar chart race:
 *
 *   [intro][period 0][period 1]…[period n-2][final hold on period n-1][outro][credits]
 *
 * The outro shows the final ranking and the end card; the credits list the sources.
 * Every period except the last lasts `framesPerPeriod`: it holds still for `holdFrames`, then
 * moves to the next period over `transitionFrames`. The last period is held for
 * `finalHoldFrames` (at least one frame), so the final chart frame always shows it exactly.
 */
export interface RaceTimeline {
  fps: number;
  periodCount: number;
  framesPerPeriod: number;
  holdFrames: number;
  transitionFrames: number;
  finalHoldFrames: number;
  introFrames: number;
  chartStartFrame: number;
  chartFrames: number;
  outroStartFrame: number;
  outroFrames: number;
  creditsStartFrame: number;
  creditsFrames: number;
  durationInFrames: number;
  easing: EasingName;
}

export function computeRaceTimeline(
  timing: RaceTiming,
  { fps, periodCount }: { fps: number; periodCount: number },
): RaceTimeline {
  if (!Number.isInteger(periodCount) || periodCount < 1) {
    throw new RangeError(`periodCount must be a positive integer, got ${periodCount}`);
  }
  if (timing.transitionSeconds > timing.secondsPerPeriod) {
    throw new RangeError('transitionSeconds cannot exceed secondsPerPeriod');
  }
  const framesPerPeriod = Math.max(1, Math.round(timing.secondsPerPeriod * fps));
  const transitionFrames = Math.min(
    framesPerPeriod,
    Math.max(1, Math.round(timing.transitionSeconds * fps)),
  );
  const finalHoldFrames = Math.max(1, Math.round(timing.finalHoldSeconds * fps));
  const introFrames = Math.round(timing.introSeconds * fps);
  const outroFrames = Math.round(timing.outroSeconds * fps);
  const creditsFrames = Math.round(timing.creditsSeconds * fps);
  const chartFrames = (periodCount - 1) * framesPerPeriod + finalHoldFrames;
  const chartStartFrame = introFrames;
  const outroStartFrame = chartStartFrame + chartFrames;
  return {
    fps,
    periodCount,
    framesPerPeriod,
    holdFrames: framesPerPeriod - transitionFrames,
    transitionFrames,
    finalHoldFrames,
    introFrames,
    chartStartFrame,
    chartFrames,
    outroStartFrame,
    outroFrames,
    creditsStartFrame: outroStartFrame + outroFrames,
    creditsFrames,
    durationInFrames: outroStartFrame + outroFrames + creditsFrames,
    easing: timing.easing,
  };
}

export type RacePhase = 'intro' | 'chart' | 'outro' | 'credits';

export interface RaceState {
  phase: RacePhase;
  /** Index of the period being shown or left. */
  periodIndex: number;
  /** Index of the period being moved to (equal to periodIndex while holding). */
  nextIndex: number;
  /** Eased progress from periodIndex to nextIndex, 0 to 1. */
  progress: number;
  /** Un-eased progress, for things that should move at constant speed. */
  linearProgress: number;
  /** Continuous position on the period axis: periodIndex + progress. */
  position: number;
}

/**
 * Where the race is at `frame` (an absolute composition frame). The intro shows period 0 and
 * the outro the last period, so the chart is never in an undefined state.
 */
export function raceStateAtFrame(timeline: RaceTimeline, frame: number): RaceState {
  const last = timeline.periodCount - 1;
  const hold = (index: number, phase: RacePhase): RaceState => ({
    phase,
    periodIndex: index,
    nextIndex: index,
    progress: 0,
    linearProgress: 0,
    position: index,
  });

  if (frame < timeline.chartStartFrame) return hold(0, 'intro');
  if (frame >= timeline.creditsStartFrame && timeline.creditsFrames > 0) {
    return hold(last, 'credits');
  }
  if (frame >= timeline.outroStartFrame) return hold(last, 'outro');

  const chartFrame = frame - timeline.chartStartFrame;
  const periodIndex = Math.floor(chartFrame / timeline.framesPerPeriod);
  if (periodIndex >= last) return hold(last, 'chart');

  const local = chartFrame - periodIndex * timeline.framesPerPeriod;
  if (local < timeline.holdFrames) return hold(periodIndex, 'chart');

  const linearProgress = (local - timeline.holdFrames) / timeline.transitionFrames;
  const progress = ease(timeline.easing, linearProgress);
  return {
    phase: 'chart',
    periodIndex,
    nextIndex: periodIndex + 1,
    progress,
    linearProgress,
    position: periodIndex + progress,
  };
}

/** First composition frame at which period `index` is shown at rest. */
export function frameForPeriod(timeline: RaceTimeline, index: number): number {
  if (index < 0 || index >= timeline.periodCount) {
    throw new RangeError(`Period index ${index} is outside 0..${timeline.periodCount - 1}`);
  }
  return timeline.chartStartFrame + index * timeline.framesPerPeriod;
}

/** One part of the video, for scene markers and checks. */
export interface RaceScene {
  id: 'intro' | 'chart' | 'outro' | 'credits';
  label: string;
  from: number;
  durationInFrames: number;
}

/** The scenes of a race in order, leaving out empty ones. */
export function raceScenes(timeline: RaceTimeline): RaceScene[] {
  const scenes: RaceScene[] = [
    { id: 'intro', label: 'Intro', from: 0, durationInFrames: timeline.introFrames },
    {
      id: 'chart',
      label: 'Bar chart race',
      from: timeline.chartStartFrame,
      durationInFrames: timeline.chartFrames,
    },
    {
      id: 'outro',
      label: 'Final ranking',
      from: timeline.outroStartFrame,
      durationInFrames: timeline.outroFrames,
    },
    {
      id: 'credits',
      label: 'Source credits',
      from: timeline.creditsStartFrame,
      durationInFrames: timeline.creditsFrames,
    },
  ];
  return scenes.filter((scene) => scene.durationInFrames > 0);
}
