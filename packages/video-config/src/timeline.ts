import type {
  AnimationSpeed,
  IntroConfiguration,
  OutroConfiguration,
} from '@statsopedia/shared-types';

/** How long the ranking animation spends moving from one year to the next. */
export const SECONDS_PER_YEAR: Record<AnimationSpeed, number> = {
  slow: 2,
  normal: 1.2,
  fast: 0.6,
};

/** How long the final year is held on screen before the outro. */
export const FINAL_YEAR_HOLD_SECONDS = 2;

/** Input of the year-based timeline used by the Phase 1 sample composition. */
export interface TimelineInput {
  fps: number;
  startYear: number;
  endYear: number;
  animationSpeed: AnimationSpeed;
  intro: IntroConfiguration;
  outro: OutroConfiguration;
}

/** Frame layout of a ranking video: [intro][chart: one segment per year step + hold][outro]. */
export interface VideoTimeline {
  fps: number;
  /** Number of year-to-year transitions (endYear - startYear). */
  yearSteps: number;
  framesPerYear: number;
  introFrames: number;
  chartStartFrame: number;
  chartFrames: number;
  outroStartFrame: number;
  outroFrames: number;
  durationInFrames: number;
}

export function computeTimeline(input: TimelineInput): VideoTimeline {
  if (input.endYear <= input.startYear) {
    throw new RangeError(`endYear (${input.endYear}) must be after startYear (${input.startYear})`);
  }
  const { fps } = input;
  const yearSteps = input.endYear - input.startYear;
  const framesPerYear = Math.max(1, Math.round(SECONDS_PER_YEAR[input.animationSpeed] * fps));
  const introFrames = input.intro.enabled ? Math.round(input.intro.durationSeconds * fps) : 0;
  const outroFrames = input.outro.enabled ? Math.round(input.outro.durationSeconds * fps) : 0;
  const chartFrames = yearSteps * framesPerYear + Math.round(FINAL_YEAR_HOLD_SECONDS * fps);
  const chartStartFrame = introFrames;
  const outroStartFrame = chartStartFrame + chartFrames;

  return {
    fps,
    yearSteps,
    framesPerYear,
    introFrames,
    chartStartFrame,
    chartFrames,
    outroStartFrame,
    outroFrames,
    durationInFrames: outroStartFrame + outroFrames,
  };
}

export interface YearPosition {
  /** Index of the year being animated *from* (0 = startYear). */
  stepIndex: number;
  /** Progress towards the next year, 0 to 1. Stays at 0 during the final hold. */
  progress: number;
}

/** Where the chart is in time, given a frame relative to the start of the chart section. */
export function yearPositionAtFrame(timeline: VideoTimeline, chartFrame: number): YearPosition {
  const frame = Math.max(0, chartFrame);
  const animatedFrames = timeline.yearSteps * timeline.framesPerYear;
  if (frame >= animatedFrames) return { stepIndex: timeline.yearSteps, progress: 0 };
  const stepIndex = Math.floor(frame / timeline.framesPerYear);
  return { stepIndex, progress: (frame % timeline.framesPerYear) / timeline.framesPerYear };
}
