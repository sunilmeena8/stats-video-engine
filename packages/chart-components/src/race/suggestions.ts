import type {
  BarChartRaceConfig,
  EditorialAnnotation,
  NormalizedDataset,
  ValueFormat,
} from '@statsopedia/shared-types';
import { formatValue } from '@statsopedia/utils';

import { buildRaceData, computeRaceFrame, formatPeriodLabel } from './model.js';

/** How many suggestions of each kind, at most. */
const LIMITS = { ranking_change: 4, top_entry: 3, value_change: 2 } as const;
/** Smallest move worth a "big change" note. */
const MIN_CHANGE = 0.25;

/**
 * Annotations read from the data itself: who takes the lead and when, who enters the top N,
 * the biggest moves, and the winner. Every one cites the dataset's sources. Nothing here is a
 * historical claim; milestones (events) are only ever written by an editor, with sources.
 */
export function suggestAnnotations(
  dataset: NormalizedDataset,
  config: Pick<BarChartRaceConfig, 'startPeriod' | 'endPeriod' | 'topN'> & {
    valueFormat: ValueFormat;
  },
): EditorialAnnotation[] {
  const data = buildRaceData(dataset, config, () => '#000000');
  const sources = dataset.sources.map((source) => ({ name: source.id, url: source.url }));
  if (!sources.length || data.keyframes.length < 2) return [];
  const name = (id: string) => data.entities.get(id)?.name ?? id;
  const label = (period: string) => formatPeriodLabel(period, data.frequency);
  const value = (amount: number) => formatValue(amount, config.valueFormat);
  const ranked = data.keyframes.map((keyframe) => ({
    period: keyframe.period,
    bars: computeRaceFrame(keyframe, keyframe, 0, config.topN, data.order).bars.filter(
      (bar) => bar.slot < config.topN,
    ),
    values: keyframe.values,
  }));
  const note = (
    id: string,
    patch: Pick<EditorialAnnotation, 'kind' | 'title' | 'text' | 'icon' | 'priority'>,
    period: string,
  ): EditorialAnnotation => ({
    id,
    imageUrl: null,
    sources,
    timing: { kind: 'period', period, durationSeconds: 3 },
    style: 'card',
    position: 'auto',
    ...patch,
  });

  const suggestions: EditorialAnnotation[] = [];

  // Lead changes.
  const leads: EditorialAnnotation[] = [];
  for (let index = 1; index < ranked.length; index++) {
    const before = ranked[index - 1]!.bars.find((bar) => bar.rank === 1 && !bar.tied);
    const after = ranked[index]!.bars.find((bar) => bar.rank === 1 && !bar.tied);
    if (before && after && before.id !== after.id) {
      leads.push(
        note(
          `lead-${ranked[index]!.period}`,
          {
            kind: 'ranking_change',
            title: `${name(after.id)} overtakes ${name(before.id)}`,
            text: `New #1 in ${label(ranked[index]!.period)} with ${value(after.value)}.`,
            icon: '▲',
            priority: 'normal',
          },
          ranked[index]!.period,
        ),
      );
    }
  }
  suggestions.push(...leads.slice(0, LIMITS.ranking_change));

  // First entries into the top N (after the first period).
  const seen = new Set(ranked[0]!.bars.map((bar) => bar.id));
  const entries: { note: EditorialAnnotation; rank: number }[] = [];
  for (const { period, bars } of ranked.slice(1)) {
    for (const bar of bars) {
      if (seen.has(bar.id)) continue;
      seen.add(bar.id);
      entries.push({
        rank: bar.rank,
        note: note(
          `entry-${bar.id}-${period}`,
          {
            kind: 'top_entry',
            title: `${name(bar.id)} enters the top ${config.topN}`,
            text: `At #${bar.rank} in ${label(period)} with ${value(bar.value)}.`,
            icon: '★',
            priority: 'low',
          },
          period,
        ),
      });
    }
  }
  suggestions.push(
    ...entries
      .sort((a, b) => a.rank - b.rank)
      .slice(0, LIMITS.top_entry)
      .map((entry) => entry.note),
  );

  // Biggest moves of entities in the top N, from one period to the next.
  const moves: { change: number; note: EditorialAnnotation }[] = [];
  for (let index = 1; index < ranked.length; index++) {
    const { period, bars, values } = ranked[index]!;
    const previous = ranked[index - 1]!.values;
    for (const bar of bars) {
      const now = values.get(bar.id);
      const then = previous.get(bar.id);
      if (!now || !then || now.estimated || then.estimated || then.value <= 0) continue;
      const change = (now.value - then.value) / then.value;
      if (Math.abs(change) < MIN_CHANGE) continue;
      moves.push({
        change,
        note: note(
          `change-${bar.id}-${period}`,
          {
            kind: 'value_change',
            title: `${name(bar.id)} ${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}%`,
            text: `From ${value(then.value)} to ${value(now.value)} in ${label(period)}.`,
            icon: change > 0 ? '↑' : '↓',
            priority: 'low',
          },
          period,
        ),
      });
    }
  }
  suggestions.push(
    ...moves
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, LIMITS.value_change)
      .map((move) => move.note),
  );

  // The winner, while the final period is held.
  const last = ranked.at(-1)!;
  const winner = last.bars.find((bar) => bar.rank === 1);
  if (winner) {
    suggestions.push(
      note(
        `winner-${last.period}`,
        {
          kind: 'winner',
          title: `${name(winner.id)} finishes #1`,
          text: `${value(winner.value)} in ${label(last.period)}.`,
          icon: '🏆',
          priority: 'high',
        },
        last.period,
      ),
    );
  }
  return suggestions;
}
