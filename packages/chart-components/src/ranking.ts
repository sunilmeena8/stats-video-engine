import { clamp, lerp } from '@statsopedia/utils';

export interface RankingEntry {
  id: string;
  label: string;
  value: number;
  /** Bar color. Assign by entity, never by rank, so colors stay put as rankings change. */
  color: string;
}

export interface RankedBar extends RankingEntry {
  /** 0-based slot from the top. Fractional while a bar is moving between ranks. */
  position: number;
}

export type RankOrder = 'desc' | 'asc';

export interface InterpolateRankingOptions {
  /** `desc` (default): largest value first. `asc`: smallest first. */
  order?: RankOrder;
  /**
   * Shapes each slide between sub-keyframes (0→1). Default is a smoothstep, so bars ease into
   * their new slot instead of moving at constant speed.
   */
  slideEasing?: (t: number) => number;
  /**
   * Sub-keyframes per step at which ranks are recomputed from the interpolated values.
   * Higher values make bars swap closer to the exact moment their values cross, over a
   * shorter slide. Default 10.
   */
  keyframesPerStep?: number;
}

/** Code-point order, the same tie-break the data-processor uses (Python string order). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sorts entries by value (descending by default), breaking ties by id so the output is
 * deterministic and matches the data-processor's `position`.
 */
export function rankEntries<T extends Pick<RankingEntry, 'value' | 'id'>>(
  entries: readonly T[],
  order: RankOrder = 'desc',
): T[] {
  const sign = order === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => sign * (a.value - b.value) || compareIds(a.id, b.id));
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

interface Track {
  entry: RankingEntry;
  fromValue: number;
  toValue: number;
  inFrom: boolean;
  inTo: boolean;
}

/**
 * Blends two ranking snapshots (typically consecutive years) at `progress` ∈ [0, 1].
 *
 * Values move linearly. Positions follow the *rank of the interpolated values*, recomputed at
 * `keyframesPerStep` sub-keyframes and blended between them, so two bars swap places when
 * their values cross, with a short slide, instead of drifting through each other for the
 * whole step.
 *
 * Entities outside the top N are parked at slot `topN`, just below the visible area, so they
 * slide in and out. An entity missing from `from` enters during the final sub-keyframe; one
 * missing from `to` leaves during the first. Missing values hold the known value.
 *
 * @returns the bars that are at least partly visible, ordered top to bottom.
 */
export function interpolateRanking(
  from: readonly RankingEntry[],
  to: readonly RankingEntry[],
  progress: number,
  topN: number,
  {
    keyframesPerStep = 10,
    order = 'desc',
    slideEasing = smoothstep,
  }: InterpolateRankingOptions = {},
): RankedBar[] {
  if (!Number.isInteger(topN) || topN < 1) {
    throw new RangeError(`topN must be a positive integer, got ${topN}`);
  }
  if (!Number.isInteger(keyframesPerStep) || keyframesPerStep < 1) {
    throw new RangeError(`keyframesPerStep must be a positive integer, got ${keyframesPerStep}`);
  }
  const t = clamp(progress, 0, 1);

  const tracks = new Map<string, Track>();
  for (const entry of from) {
    tracks.set(entry.id, {
      entry,
      fromValue: entry.value,
      toValue: entry.value,
      inFrom: true,
      inTo: false,
    });
  }
  for (const entry of to) {
    const existing = tracks.get(entry.id);
    tracks.set(entry.id, {
      entry,
      fromValue: existing?.fromValue ?? entry.value,
      toValue: entry.value,
      inFrom: existing !== undefined,
      inTo: true,
    });
  }
  const all = [...tracks.values()];

  /** Slot of every entity at sub-keyframe `s` ∈ [0, 1], capped at `topN`. */
  const slotsAt = (s: number): Map<string, number> => {
    const present = all.filter((track) => (track.inFrom || s === 1) && (track.inTo || s === 0));
    const ranked = rankEntries(
      present.map((track) => ({
        id: track.entry.id,
        value: lerp(track.fromValue, track.toValue, s),
      })),
      order,
    );
    return new Map(ranked.map((item, index) => [item.id, Math.min(index, topN)]));
  };

  const scaled = t * keyframesPerStep;
  const keyframe = Math.min(Math.floor(scaled), keyframesPerStep - 1);
  const local = slideEasing(clamp(scaled - keyframe, 0, 1));
  const startSlots = slotsAt(keyframe / keyframesPerStep);
  const endSlots = slotsAt((keyframe + 1) / keyframesPerStep);

  const bars: RankedBar[] = [];
  for (const track of all) {
    const position = lerp(
      startSlots.get(track.entry.id) ?? topN,
      endSlots.get(track.entry.id) ?? topN,
      local,
    );
    if (position >= topN) continue;
    bars.push({ ...track.entry, value: lerp(track.fromValue, track.toValue, t), position });
  }
  return bars.sort((a, b) => a.position - b.position);
}
