import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  RankedBarChart,
  interpolateRanking,
  rankEntries,
  type RankingEntry,
} from '../src/index.js';

const entry = (id: string, value: number): RankingEntry => ({
  id,
  label: id.toUpperCase(),
  value,
  color: '#3987e5',
});

describe('rankEntries', () => {
  it('sorts by value descending and breaks ties by id', () => {
    const ranked = rankEntries([entry('b', 5), entry('a', 5), entry('c', 9)]);
    expect(ranked.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('interpolateRanking', () => {
  const from = [entry('a', 100), entry('b', 50), entry('c', 10)];
  const to = [entry('a', 60), entry('b', 80), entry('c', 10)];

  it('returns the start snapshot at progress 0 and the end snapshot at progress 1', () => {
    expect(interpolateRanking(from, to, 0, 3).map((bar) => [bar.id, bar.position])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(interpolateRanking(from, to, 1, 3).map((bar) => [bar.id, bar.position])).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ]);
  });

  it('interpolates values linearly but swaps ranks only where the values cross', () => {
    // a: 100 → 60 and b: 50 → 80 cross at progress 5/7 ≈ 0.714.
    const early = interpolateRanking(from, to, 0.5, 3);
    expect(early.find((bar) => bar.id === 'a')).toMatchObject({ value: 80, position: 0 });

    // Between sub-keyframes 0.7 and 0.8 the two bars are mid-swap.
    const crossing = interpolateRanking(from, to, 0.75, 3);
    expect(crossing.find((bar) => bar.id === 'a')?.position).toBeCloseTo(0.5);
    expect(crossing.find((bar) => bar.id === 'b')?.position).toBeCloseTo(0.5);

    const late = interpolateRanking(from, to, 0.85, 3);
    expect(late.map((bar) => bar.id)).toEqual(['b', 'a', 'c']);
  });

  it('slides entities in from below the visible slots as their value climbs', () => {
    // c: 10 → 200 overtakes b (50) at progress ≈ 0.21.
    const enter = [entry('a', 100), entry('b', 50), entry('c', 200)];
    expect(interpolateRanking(from, enter, 0, 2).some((bar) => bar.id === 'c')).toBe(false);
    expect(
      interpolateRanking(from, enter, 0.25, 2).find((bar) => bar.id === 'c')?.position,
    ).toBeCloseTo(1.5);
    expect(interpolateRanking(from, enter, 1, 2)[0]?.id).toBe('c');
  });

  it('brings in entities that only exist in the target snapshot during the last sub-keyframe', () => {
    const target = [...to, entry('d', 500)];
    expect(interpolateRanking(from, target, 0.5, 4).some((bar) => bar.id === 'd')).toBe(false);
    expect(
      interpolateRanking(from, target, 0.95, 4).find((bar) => bar.id === 'd')?.position,
    ).toBeCloseTo(2);
    expect(interpolateRanking(from, target, 1, 4)[0]?.id).toBe('d');
  });

  it('rejects a non-positive topN', () => {
    expect(() => interpolateRanking(from, to, 0.5, 0)).toThrow(RangeError);
  });
});

describe('RankedBarChart', () => {
  it('renders one labelled bar per visible entry', () => {
    const bars = interpolateRanking(
      [entry('a', 1_500_000), entry('b', 900)],
      [entry('a', 1_500_000), entry('b', 900)],
      0,
      2,
    );
    const html = renderToStaticMarkup(
      createElement(RankedBarChart, {
        bars,
        topN: 2,
        width: 800,
        height: 200,
        theme: {
          textPrimary: '#fff',
          textSecondary: '#ccc',
          gridLine: '#333',
          fontFamily: 'sans-serif',
        },
      }),
    );
    expect(html.match(/data-bar-id=/g)).toHaveLength(2);
    expect(html).toContain('1.5M');
    expect(html).toContain('900');
  });
});
