import type { EditorialAnnotation, NormalizedDataset } from '@statsopedia/shared-types';
import { computeRaceTimeline } from '@statsopedia/video-config';
import { describe, expect, it } from 'vitest';

import fixture from '../../shared-schemas/test/fixtures/normalized-dataset.json' with { type: 'json' };
import {
  axisTicks,
  barFraction,
  buildRaceData,
  computeRaceFrame,
  fitFontSize,
  formatPeriodLabel,
  initials,
  musicVolumeAt,
  readableTextColor,
  resolveAnnotationWindows,
  type RaceKeyframe,
} from '../src/index.js';

const dataset = fixture as NormalizedDataset;
const colors = ['#111111', '#222222', '#333333'];
const data = buildRaceData(dataset, { startPeriod: null, endPeriod: null }, (i) => colors[i % 3]!);

function keyframe(
  period: string,
  values: Record<string, number>,
  estimated: string[] = [],
): RaceKeyframe {
  return {
    period,
    values: new Map(
      Object.entries(values).map(([id, value]) => [
        id,
        { value, estimated: estimated.includes(id), zeroFilled: false },
      ]),
    ),
  };
}

describe('buildRaceData (from the Python-generated normalized dataset)', () => {
  it('builds one keyframe per period with stable, id-ordered entity colors', () => {
    expect(data.periods).toEqual(['2015', '2016', '2017', '2018', '2019', '2020']);
    expect(data.keyframes).toHaveLength(6);
    expect([...data.entities.keys()]).toEqual(['AUR', 'BRK', 'CDR', 'DLT', 'ELM']);
    expect(data.entities.get('AUR')?.color).toBe('#111111');
    expect(data.order).toBe('desc');
  });

  it('keeps observations exact and marks the processor’s gap estimates', () => {
    expect(data.keyframes[0]!.values.get('AUR')).toEqual({
      value: 120.5,
      estimated: false,
      zeroFilled: false,
    });
    // CDR has no 2016 value; the processor bridged the one-year gap with an estimate.
    expect(data.keyframes[1]!.values.get('CDR')).toMatchObject({ value: 101.5, estimated: true });
    // ELM only starts in 2017.
    expect(data.keyframes[1]!.values.has('ELM')).toBe(false);
  });

  it('renders a sub-range of periods', () => {
    const sub = buildRaceData(dataset, { startPeriod: '2017', endPeriod: '2019' }, () => '#000000');
    expect(sub.periods).toEqual(['2017', '2018', '2019']);
    expect(() =>
      buildRaceData(dataset, { startPeriod: '2019', endPeriod: '2017' }, () => '#000'),
    ).toThrow();
  });
});

describe('computeRaceFrame', () => {
  it('shows each period exactly at progress 0 and 1', () => {
    const [k2015, k2016] = [data.keyframes[0]!, data.keyframes[1]!];
    const start = computeRaceFrame(k2015, k2016, 0, 4, 'desc');
    expect(start.bars.map((b) => [b.id, b.value, b.slot])).toEqual([
      ['AUR', 120.5, 0],
      ['BRK', 98, 1],
      ['CDR', 98, 2],
      ['DLT', 45.25, 3],
    ]);
    const end = computeRaceFrame(k2015, k2016, 1, 4, 'desc');
    expect(end.bars.map((b) => b.value)).toEqual([130, 110, 101.5, 60]);
  });

  it('gives tied values the same rank and orders them by id', () => {
    const tie = computeRaceFrame(data.keyframes[0]!, data.keyframes[0]!, 0, 4, 'desc');
    expect(tie.bars.map((b) => [b.id, b.rank, b.tied])).toEqual([
      ['AUR', 1, false],
      ['BRK', 2, true],
      ['CDR', 2, true],
      ['DLT', 4, false],
    ]);
  });

  it('interpolates values linearly and swaps slots when values cross', () => {
    const from = keyframe('2000', { A: 100, B: 50 });
    const to = keyframe('2001', { A: 100, B: 150 });
    const mid = computeRaceFrame(from, to, 0.5, 2, 'desc');
    expect(mid.bars.find((b) => b.id === 'B')?.value).toBe(100);
    expect(computeRaceFrame(from, to, 0.3, 2, 'desc').bars[0]?.id).toBe('A');
    expect(computeRaceFrame(from, to, 0.9, 2, 'desc').bars[0]?.id).toBe('B');
  });

  it('ranks ascending when the metric asks for it', () => {
    const k = keyframe('2000', { A: 3, B: 1, C: 2 });
    expect(computeRaceFrame(k, k, 0, 3, 'asc').bars.map((b) => b.id)).toEqual(['B', 'C', 'A']);
  });

  it('slides entering entities in from below and leaving ones out, fading', () => {
    const from = keyframe('2000', { A: 10, B: 8, C: 6 });
    const to = keyframe('2001', { A: 10, B: 8, D: 20 });
    const early = computeRaceFrame(from, to, 0.02, 3, 'desc');
    expect(early.bars.some((b) => b.id === 'D')).toBe(false);
    const leaving = early.bars.find((b) => b.id === 'C')!;
    expect(leaving.slot).toBeGreaterThan(2);
    expect(leaving.opacity).toBeLessThan(1);
    const late = computeRaceFrame(from, to, 0.97, 3, 'desc');
    const entering = late.bars.find((b) => b.id === 'D')!;
    expect(entering.slot).toBeLessThan(3);
    expect(computeRaceFrame(from, to, 1, 3, 'desc').bars[0]?.id).toBe('D');
    expect(computeRaceFrame(from, to, 1, 3, 'desc').bars.some((b) => b.id === 'C')).toBe(false);
  });

  it('keeps the bar scale continuous while a large bar enters', () => {
    const from = keyframe('2000', { A: 10, B: 8 });
    const to = keyframe('2001', { A: 10, B: 8, Z: 100 });
    let previous = computeRaceFrame(from, to, 0, 2, 'desc').scaleMax;
    for (let step = 1; step <= 100; step++) {
      const { scaleMax } = computeRaceFrame(from, to, step / 100, 2, 'desc');
      // 100 frames over a 90-unit rescale: no single frame may move it by more than ~3%.
      expect(Math.abs(scaleMax - previous)).toBeLessThan(3);
      previous = scaleMax;
    }
    expect(previous).toBe(100);
  });

  it('handles empty periods, zero and negative values', () => {
    const empty = keyframe('2000', {});
    expect(computeRaceFrame(empty, empty, 0.5, 3, 'desc')).toEqual({
      bars: [],
      scaleMax: 0,
      empty: true,
    });
    const zeros = keyframe('2000', { A: 0, B: 0 });
    const frame = computeRaceFrame(zeros, zeros, 0, 3, 'desc');
    expect(frame.scaleMax).toBe(0);
    expect(frame.bars.map((b) => [b.id, b.rank, b.tied])).toEqual([
      ['A', 1, true],
      ['B', 1, true],
    ]);
    expect(barFraction(0, 0)).toBe(0);
    expect(barFraction(-5, 10)).toBe(0);
    expect(barFraction(5, 10)).toBe(0.5);
    expect(barFraction(15, 10)).toBe(1);
  });

  it('flags estimates from the nearest keyframe', () => {
    const from = keyframe('2000', { A: 10 });
    const to = keyframe('2001', { A: 20 }, ['A']);
    expect(computeRaceFrame(from, to, 0.2, 3, 'desc').bars[0]?.estimated).toBe(false);
    expect(computeRaceFrame(from, to, 0.8, 3, 'desc').bars[0]?.estimated).toBe(true);
  });

  it('is deterministic', () => {
    const a = computeRaceFrame(data.keyframes[2]!, data.keyframes[3]!, 0.4321, 4, 'desc');
    const b = computeRaceFrame(data.keyframes[2]!, data.keyframes[3]!, 0.4321, 4, 'desc');
    expect(a).toEqual(b);
  });
});

describe('axisTicks', () => {
  it('produces nice, increasing ticks inside the scale', () => {
    // 170 / 4 = 42.5: between the nice steps 20 and 50, so the 20s are fading out
    // and multiples of 50 stay fully visible.
    const ticks = axisTicks(170);
    expect(ticks.find((t) => t.value === 100)?.opacity).toBe(1);
    expect(ticks.find((t) => t.value === 40)!.opacity).toBeLessThan(0.5);
    expect(ticks.every((t) => t.fraction > 0 && t.fraction <= 1)).toBe(true);
    expect(axisTicks(0)).toEqual([]);
  });

  it('fades ticks smoothly as the scale grows (no popping)', () => {
    const opacityOf = (scale: number, value: number) =>
      axisTicks(scale).find((tick) => tick.value === value)?.opacity ?? 0;
    let previous = opacityOf(80, 20);
    for (let scale = 81; scale <= 200; scale++) {
      const current = opacityOf(scale, 20);
      expect(Math.abs(current - previous)).toBeLessThan(0.15);
      previous = current;
    }
  });
});

describe('labels and text', () => {
  it('formats periods per frequency', () => {
    expect(formatPeriodLabel('2017', 'yearly')).toBe('2017');
    expect(formatPeriodLabel('-499', 'yearly')).toBe('500 BCE');
    expect(formatPeriodLabel('2017-03', 'monthly')).toBe('Mar 2017');
    expect(formatPeriodLabel('2017-03-05', 'daily')).toBe('5 Mar 2017');
  });

  it('builds monograms, readable text colors and fitted name sizes', () => {
    expect(initials('United Kingdom')).toBe('UK');
    expect(initials('Côte d’Ivoire')).toBe('CD');
    expect(readableTextColor('#ffffff')).toBe('#0b0b0b');
    expect(readableTextColor('#0b1020')).toBe('#ffffff');
    expect(fitFontSize('Short', 300, 30)).toBe(30);
    expect(fitFontSize('An Extremely Long Entity Name For Testing Purposes', 300, 30)).toBe(
      30 * 0.72,
    );
  });
});

describe('annotations and music', () => {
  const timeline = computeRaceTimeline(
    {
      secondsPerPeriod: 1,
      transitionSeconds: 0.5,
      easing: 'linear',
      introSeconds: 2,
      outroSeconds: 2,
      finalHoldSeconds: 2,
      creditsSeconds: 0,
    },
    { fps: 30, periodCount: 6 },
  );
  const annotation = (id: string, timing: EditorialAnnotation['timing']): EditorialAnnotation => ({
    id,
    kind: 'caption',
    title: 'Milestone',
    text: null,
    icon: null,
    imageUrl: null,
    sources: [],
    timing,
    priority: 'normal',
    style: 'card',
    position: 'bottom-right',
  });

  it('anchors annotations to periods or explicit frames, clipped to the chart', () => {
    const windows = resolveAnnotationWindows(
      [
        annotation('p', { kind: 'period', period: '2017', durationSeconds: 3 }),
        annotation('f', { kind: 'frames', startFrame: 10, endFrame: 100 }),
        annotation('missing', { kind: 'period', period: '1999', durationSeconds: 3 }),
        annotation('t', { kind: 'time', startSeconds: 1, endSeconds: 3.5 }),
      ],
      data.periods,
      timeline,
    );
    expect(windows.map((w) => [w.annotation.id, w.from, w.durationInFrames])).toEqual([
      ['p', 60 + 2 * 30, 90],
      ['f', 60, 40],
      ['t', 60, 45],
    ]);
  });

  it('fades music in and out and never exceeds the configured volume', () => {
    const music = { volume: 0.6, fadeInSeconds: 1, fadeOutSeconds: 2 };
    const video = { fps: 30, durationInFrames: 300 };
    expect(musicVolumeAt(0, music, video)).toBe(0);
    expect(musicVolumeAt(15, music, video)).toBeCloseTo(0.3);
    expect(musicVolumeAt(150, music, video)).toBeCloseTo(0.6);
    expect(musicVolumeAt(299, music, video)).toBe(0);
    for (let frame = 0; frame < 300; frame++) {
      expect(musicVolumeAt(frame, music, video)).toBeLessThanOrEqual(0.6);
    }
    expect(musicVolumeAt(150, { ...music, volume: 3 }, video)).toBe(1);
  });
});

describe('rank numbers', () => {
  it('always agree with the on-screen order, also mid-swap', () => {
    const from = keyframe('2000', { A: 100, B: 90, C: 10 });
    const to = keyframe('2001', { A: 100, B: 120, C: 10 });
    for (let step = 0; step <= 50; step++) {
      const { bars } = computeRaceFrame(from, to, step / 50, 3, 'desc');
      const byValue = [...bars].sort((a, b) => b.value - a.value);
      byValue.forEach((bar, index) => {
        if (index > 0 && bar.value === byValue[index - 1]!.value) return;
        expect(bar.rank).toBe(index + 1);
      });
    }
  });
});
