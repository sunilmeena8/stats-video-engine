import type { RaceTiming } from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import {
  EASINGS,
  computeRaceTimeline,
  frameForPeriod,
  raceScenes,
  raceStateAtFrame,
} from '../src/index.js';

const timing: RaceTiming = {
  secondsPerPeriod: 1,
  transitionSeconds: 0.5,
  easing: 'linear',
  introSeconds: 2,
  outroSeconds: 3,
  finalHoldSeconds: 1.5,
  creditsSeconds: 0,
};

describe('computeRaceTimeline', () => {
  it('lays out intro, periods, final hold and outro in frames', () => {
    const timeline = computeRaceTimeline(timing, { fps: 30, periodCount: 5 });
    expect(timeline).toMatchObject({
      framesPerPeriod: 30,
      holdFrames: 15,
      transitionFrames: 15,
      finalHoldFrames: 45,
      introFrames: 60,
      chartStartFrame: 60,
      chartFrames: 4 * 30 + 45,
      outroStartFrame: 225,
      creditsStartFrame: 315,
      creditsFrames: 0,
      durationInFrames: 225 + 90,
    });
  });

  it('adds the credits scene after the outro', () => {
    const timeline = computeRaceTimeline(
      { ...timing, creditsSeconds: 4 },
      { fps: 30, periodCount: 5 },
    );
    expect(timeline.creditsStartFrame).toBe(315);
    expect(timeline.durationInFrames).toBe(315 + 120);
    expect(raceStateAtFrame(timeline, 320)).toMatchObject({ phase: 'credits', position: 4 });
    expect(raceStateAtFrame(timeline, 314)).toMatchObject({ phase: 'outro' });
    expect(
      raceScenes(timeline).map((scene) => [scene.id, scene.from, scene.durationInFrames]),
    ).toEqual([
      ['intro', 0, 60],
      ['chart', 60, 165],
      ['outro', 225, 90],
      ['credits', 315, 120],
    ]);
    // Empty scenes are left out.
    expect(
      raceScenes(
        computeRaceTimeline({ ...timing, introSeconds: 0 }, { fps: 30, periodCount: 5 }),
      ).map((s) => s.id),
    ).toEqual(['chart', 'outro']);
  });

  it('supports a single period and continuous motion (no hold)', () => {
    const single = computeRaceTimeline(timing, { fps: 30, periodCount: 1 });
    expect(single.chartFrames).toBe(45);
    const continuous = computeRaceTimeline(
      { ...timing, transitionSeconds: 1 },
      { fps: 60, periodCount: 3 },
    );
    expect(continuous.holdFrames).toBe(0);
    expect(continuous.transitionFrames).toBe(60);
  });

  it('rejects invalid input', () => {
    expect(() => computeRaceTimeline(timing, { fps: 30, periodCount: 0 })).toThrow(RangeError);
    expect(() =>
      computeRaceTimeline({ ...timing, transitionSeconds: 2 }, { fps: 30, periodCount: 3 }),
    ).toThrow(RangeError);
  });
});

describe('raceStateAtFrame (year-to-frame mapping)', () => {
  const timeline = computeRaceTimeline(timing, { fps: 30, periodCount: 5 });

  it('holds the first period during the intro', () => {
    expect(raceStateAtFrame(timeline, 0)).toMatchObject({ phase: 'intro', position: 0 });
    expect(raceStateAtFrame(timeline, 59)).toMatchObject({ phase: 'intro', position: 0 });
  });

  it('holds, then moves to the next period', () => {
    expect(raceStateAtFrame(timeline, 60)).toMatchObject({ phase: 'chart', position: 0 });
    expect(raceStateAtFrame(timeline, 74)).toMatchObject({ periodIndex: 0, progress: 0 });
    expect(raceStateAtFrame(timeline, 75)).toMatchObject({
      periodIndex: 0,
      nextIndex: 1,
      progress: 0,
    });
    expect(raceStateAtFrame(timeline, 82).progress).toBeCloseTo(7 / 15);
    expect(raceStateAtFrame(timeline, 90)).toMatchObject({ periodIndex: 1, position: 1 });
  });

  it('maps every period to the frame where it is shown at rest', () => {
    for (let index = 0; index < 5; index++) {
      const state = raceStateAtFrame(timeline, frameForPeriod(timeline, index));
      expect(state).toMatchObject({ periodIndex: index, progress: 0, position: index });
    }
    expect(() => frameForPeriod(timeline, 5)).toThrow(RangeError);
  });

  it('shows the final period exactly on the last chart frame and throughout the outro', () => {
    expect(raceStateAtFrame(timeline, timeline.outroStartFrame - 1)).toMatchObject({
      phase: 'chart',
      periodIndex: 4,
      position: 4,
    });
    expect(raceStateAtFrame(timeline, timeline.durationInFrames - 1)).toMatchObject({
      phase: 'outro',
      position: 4,
    });
  });

  it('is monotonic: the period axis never moves backwards', () => {
    let previous = -1;
    for (let frame = 0; frame < timeline.durationInFrames; frame++) {
      const { position } = raceStateAtFrame(timeline, frame);
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
  });

  it('applies easing to progress but not to linearProgress', () => {
    const eased = computeRaceTimeline(
      { ...timing, easing: 'easeInOut' },
      { fps: 30, periodCount: 2 },
    );
    const state = raceStateAtFrame(eased, eased.chartStartFrame + 15 + 3);
    expect(state.linearProgress).toBeCloseTo(0.2);
    expect(state.progress).toBeCloseTo(EASINGS.easeInOut(0.2));
    expect(state.progress).toBeLessThan(state.linearProgress);
  });
});

describe('easings', () => {
  it.each(Object.entries(EASINGS))('%s maps 0→0 and 1→1', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0);
    expect(fn(1)).toBeCloseTo(1);
  });
});
