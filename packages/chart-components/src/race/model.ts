import type {
  BarChartRaceConfig,
  DataFrequency,
  EditorialAnnotation,
  NormalizedDataset,
  RaceMusic,
} from '@statsopedia/shared-types';
import { clamp, lerp } from '@statsopedia/utils';
import { frameForPeriod, type RaceTimeline } from '@statsopedia/video-config';

import { compareIds, interpolateRanking, rankEntries, type RankOrder } from '../ranking.js';

// ─── Data ────────────────────────────────────────────────────────────────────────────────────

export interface RaceEntity {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  color: string;
}

export interface RaceValue {
  value: number;
  /** A data-processor estimate (bridged gap), not an observation. */
  estimated: boolean;
  /** Missing value ranked as zero (missing-value policy `zero`). */
  zeroFilled: boolean;
}

/** One period's known values. Visual interpolation happens between keyframes, never inside. */
export interface RaceKeyframe {
  period: string;
  values: ReadonlyMap<string, RaceValue>;
}

export interface RaceData {
  frequency: DataFrequency;
  periods: string[];
  keyframes: RaceKeyframe[];
  entities: ReadonlyMap<string, RaceEntity>;
  order: RankOrder;
}

/**
 * Turns a normalized dataset into per-period keyframes. Values come from the data-processor's
 * frames at each period (progress 0): original observations, explicit zero-fills and its
 * gap estimates, so the renderer re-uses the processor's interpolation decisions instead of
 * re-deciding them. Entity colors follow the entity's position in id order, never its rank.
 */
export function buildRaceData(
  dataset: NormalizedDataset,
  range: Pick<BarChartRaceConfig, 'startPeriod' | 'endPeriod'>,
  colorFor: (entityIndex: number) => string,
): RaceData {
  const all = dataset.timeRange.periods;
  const start = range.startPeriod === null ? 0 : all.indexOf(range.startPeriod);
  const end = range.endPeriod === null ? all.length - 1 : all.indexOf(range.endPeriod);
  if (start < 0 || end < 0 || end < start) {
    throw new RangeError(`Invalid period range ${range.startPeriod}–${range.endPeriod}`);
  }
  const periods = all.slice(start, end + 1);

  const atRest = new Map(
    dataset.frames.filter((frame) => frame.progress === 0).map((f) => [f.fromPeriod, f]),
  );
  const keyframes = periods.map((period) => {
    const values = new Map<string, RaceValue>();
    for (const entry of atRest.get(period)?.entries ?? []) {
      values.set(entry.entityId, {
        value: entry.value,
        estimated: entry.valueKind === 'interpolated',
        zeroFilled: entry.valueKind === 'zero_filled',
      });
    }
    return { period, values };
  });

  const sorted = [...dataset.entities].sort((a, b) => compareIds(a.id, b.id));
  const entities = new Map(
    sorted.map((entity, index) => [
      entity.id,
      {
        id: entity.id,
        name: entity.name,
        category: entity.category,
        imageUrl: entity.imageUrl,
        color: colorFor(index),
      },
    ]),
  );
  return {
    frequency: dataset.timeRange.frequency,
    periods,
    keyframes,
    entities,
    order: dataset.metric.rankingOrder,
  };
}

// ─── One frame ───────────────────────────────────────────────────────────────────────────────

export interface RaceBar {
  id: string;
  value: number;
  /** 0-based slot from the top, fractional while moving. `topN` is just below the chart. */
  slot: number;
  /** 0–1: fades as a bar slides in from or out to below the last slot. */
  opacity: number;
  /** Competition rank of the value on screen (ties share a rank). */
  rank: number;
  tied: boolean;
  estimated: boolean;
  zeroFilled: boolean;
}

export interface RaceFrame {
  bars: RaceBar[];
  /** Value that maps to a full-width bar. Continuous across frames, so bars never jump. */
  scaleMax: number;
  /** True when neither surrounding period has any value. */
  empty: boolean;
}

/**
 * Bars for the transition from `from` to `to` at eased `progress`. Values move linearly;
 * slots follow the rank of the interpolated values (see interpolateRanking), so bars swap
 * when their values cross. Entities enter and leave by sliding from and to slot `topN`.
 */
export function computeRaceFrame(
  from: RaceKeyframe,
  to: RaceKeyframe,
  progress: number,
  topN: number,
  order: RankOrder,
): RaceFrame {
  const t = clamp(progress, 0, 1);
  const toEntries = (keyframe: RaceKeyframe) =>
    [...keyframe.values].map(([id, v]) => ({ id, label: id, value: v.value, color: '' }));
  const fromEntries = toEntries(from);
  const toEntriesList = toEntries(to);
  if (fromEntries.length === 0 && toEntriesList.length === 0) {
    return { bars: [], scaleMax: 0, empty: true };
  }

  const positioned = interpolateRanking(fromEntries, toEntriesList, t, topN, { order });

  // Ranks follow the values on screen, so a rank number changes exactly when two bars swap.
  // Equal values (ties) share a rank; that only happens when the values really are equal.
  const ranked = rankEntries(
    positioned.map((bar) => ({ id: bar.id, value: bar.value })),
    order,
  );
  const ranks = new Map<string, { rank: number; tied: boolean }>();
  ranked.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const rank = previous?.value === entry.value ? ranks.get(previous.id)!.rank : index + 1;
    ranks.set(entry.id, { rank, tied: false });
  });
  const counts = new Map<number, number>();
  for (const { rank } of ranks.values()) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  for (const info of ranks.values()) info.tied = (counts.get(info.rank) ?? 0) > 1;

  // "est." follows the period the frame is closer to.
  const nearest = t < 0.5 ? from : to;
  const bars = positioned.map((bar): RaceBar => {
    const near = nearest.values.get(bar.id) ?? from.values.get(bar.id) ?? to.values.get(bar.id);
    const rank = ranks.get(bar.id);
    return {
      id: bar.id,
      value: bar.value,
      slot: bar.position,
      opacity: clamp(topN - bar.position, 0, 1),
      rank: rank?.rank ?? Math.round(bar.position) + 1,
      tied: rank?.tied ?? false,
      estimated: near?.estimated ?? false,
      zeroFilled: near?.zeroFilled ?? false,
    };
  });

  // Entering and leaving entities only slide during part of the transition; weighting their
  // share of the scale by the whole transition's progress spreads any rescale over it, so
  // the other bars shrink or grow smoothly instead of snapping when a large bar appears.
  const weight = (id: string) => {
    const inFrom = from.values.has(id);
    const inTo = to.values.has(id);
    if (inFrom && inTo) return 1;
    return inTo ? t : 1 - t;
  };
  const scaleMax = Math.max(
    0,
    ...positioned.map((bar) => Math.max(0, bar.value) * weight(bar.id)),
    ...[...to.values].map(([id, v]) => (from.values.has(id) ? 0 : Math.max(0, v.value) * t)),
  );
  return { bars, scaleMax, empty: false };
}

/** Bar length as a fraction of the track. Zero and negative values have no length. */
export function barFraction(value: number, scaleMax: number): number {
  if (!(scaleMax > 0) || !(value > 0)) return 0;
  return clamp(value / scaleMax, 0, 1);
}

// ─── Axis ────────────────────────────────────────────────────────────────────────────────────

export interface AxisTick {
  value: number;
  /** 0–1 of the track. */
  fraction: number;
  opacity: number;
}

function niceStepAtOrBelow(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / power;
  const nice = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return nice * power;
}

function nextNiceStep(step: number): number {
  const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const mantissa = Math.round(step / power);
  return mantissa === 1 ? 2 * power : mantissa === 2 ? 5 * power : 10 * power;
}

/**
 * Gridline ticks for a scale that changes every frame. Between two "nice" steps the finer
 * ticks fade out as the scale grows, so ticks never pop in or out.
 */
export function axisTicks(scaleMax: number, targetCount = 4): AxisTick[] {
  targetCount = Math.max(1, targetCount);
  if (!(scaleMax > 0)) return [];
  const raw = scaleMax / targetCount;
  const fine = niceStepAtOrBelow(raw);
  const coarse = nextNiceStep(fine);
  const weight = clamp(
    (Math.log(raw) - Math.log(fine)) / (Math.log(coarse) - Math.log(fine)),
    0,
    1,
  );
  const ticks: AxisTick[] = [];
  for (let index = 1; index * fine <= scaleMax * 1.0001; index++) {
    const value = index * fine;
    const onCoarse = Math.abs(value / coarse - Math.round(value / coarse)) < 1e-6;
    const fraction = value / scaleMax;
    // Fade ticks out as they approach the end of the track (where value labels sit).
    const edgeFade = clamp((1 - fraction) / 0.08, 0, 1);
    ticks.push({ value, fraction, opacity: (onCoarse ? 1 : 1 - weight) * edgeFade });
  }
  return ticks.filter((tick) => tick.opacity > 0.01);
}

// ─── Labels ──────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2017", "Mar 2017", "15 Mar 2017"; negative years read "500 BCE". */
export function formatPeriodLabel(period: string, frequency: DataFrequency): string {
  if (frequency === 'yearly') {
    const year = Number(period);
    return year <= 0 ? `${1 - year} BCE` : String(year);
  }
  const [year, month, day] = period.split('-');
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return frequency === 'monthly' ? `${monthName} ${year}` : `${Number(day)} ${monthName} ${year}`;
}

/** Up to two initials for an entity without a logo ("United Kingdom" → "UK"). */
export function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.slice(0, 2).map((word) => [...word][0]!.toUpperCase());
  return letters.join('') || '?';
}

/** Black or white text, whichever reads better on `hex`. */
export function readableTextColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#ffffff';
  const n = Number.parseInt(match[1]!, 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return luminance > 0.36 ? '#0b0b0b' : '#ffffff';
}

/** Font size that fits `text` in `width` px, never below `minRatio` of `base` (then ellipsis). */
export function fitFontSize(text: string, width: number, base: number, minRatio = 0.72): number {
  const estimated = width / Math.max(1, [...text].length * 0.54);
  return clamp(estimated, base * minRatio, base);
}

// ─── Annotations and music ───────────────────────────────────────────────────────────────────

export interface AnnotationWindow {
  annotation: EditorialAnnotation;
  from: number;
  durationInFrames: number;
}

export interface AnnotationTimingResult {
  /** Requested frames, before clipping to the chart section. */
  requestedFrom: number;
  requestedEnd: number;
  /** `outside`: never on screen (period not rendered, or no overlap with the chart section). */
  status: 'ok' | 'clipped' | 'outside';
  from: number;
  end: number;
}

/**
 * Frames an annotation asks for, clipped to the chart section (annotations never cover the
 * intro, the final ranking or the credits).
 */
export function resolveAnnotationTiming(
  annotation: EditorialAnnotation,
  periods: readonly string[],
  timeline: RaceTimeline,
): AnnotationTimingResult {
  let start: number;
  let end: number;
  const { timing } = annotation;
  if (timing.kind === 'period') {
    const index = periods.indexOf(timing.period);
    if (index < 0) return { requestedFrom: 0, requestedEnd: 0, status: 'outside', from: 0, end: 0 };
    start = frameForPeriod(timeline, index);
    end = start + Math.round(timing.durationSeconds * timeline.fps);
  } else if (timing.kind === 'time') {
    start = Math.round(timing.startSeconds * timeline.fps);
    end = Math.round(timing.endSeconds * timeline.fps);
  } else {
    start = timing.startFrame;
    end = timing.endFrame;
  }
  const from = Math.max(start, timeline.chartStartFrame);
  const clippedEnd = Math.min(end, timeline.outroStartFrame);
  if (clippedEnd <= from) {
    return { requestedFrom: start, requestedEnd: end, status: 'outside', from: 0, end: 0 };
  }
  return {
    requestedFrom: start,
    requestedEnd: end,
    status: from !== start || clippedEnd !== end ? 'clipped' : 'ok',
    from,
    end: clippedEnd,
  };
}

/** Resolves annotation timing to composition frames, clipped to the chart section. */
export function resolveAnnotationWindows(
  annotations: readonly EditorialAnnotation[],
  periods: readonly string[],
  timeline: RaceTimeline,
): AnnotationWindow[] {
  const windows: AnnotationWindow[] = [];
  for (const annotation of annotations) {
    const timing = resolveAnnotationTiming(annotation, periods, timeline);
    if (timing.status !== 'outside') {
      windows.push({ annotation, from: timing.from, durationInFrames: timing.end - timing.from });
    }
  }
  return windows;
}

/**
 * Music volume at `frame`: fades in from 0, holds at `volume` (≤ 1, so never amplified), and
 * fades out to exactly 0 on the last frame, so the track never ends abruptly.
 */
export function musicVolumeAt(
  frame: number,
  music: Pick<RaceMusic, 'volume' | 'fadeInSeconds' | 'fadeOutSeconds'>,
  { fps, durationInFrames }: { fps: number; durationInFrames: number },
): number {
  const volume = clamp(music.volume, 0, 1);
  const fadeIn = Math.max(1, Math.round(music.fadeInSeconds * fps));
  const fadeOut = Math.max(1, Math.round(music.fadeOutSeconds * fps));
  const last = durationInFrames - 1;
  const inGain = clamp(frame / fadeIn, 0, 1);
  const outGain = clamp((last - frame) / fadeOut, 0, 1);
  return lerp(0, volume, Math.min(inGain, outGain));
}

/** Ranks of the final period, best first (at most `count`), as shown on the final ranking. */
export function finalStandings(
  data: RaceData,
  count: number,
): { id: string; rank: number; tied: boolean; value: number; entity: RaceEntity }[] {
  const last = data.keyframes.at(-1);
  if (!last) return [];
  return computeRaceFrame(last, last, 0, count, data.order)
    .bars.filter((bar) => bar.slot < count && data.entities.has(bar.id))
    .sort((a, b) => a.slot - b.slot)
    .map((bar) => ({
      id: bar.id,
      rank: bar.rank,
      tied: bar.tied,
      value: bar.value,
      entity: data.entities.get(bar.id)!,
    }));
}
