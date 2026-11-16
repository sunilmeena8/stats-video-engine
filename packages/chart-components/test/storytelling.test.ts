import { DEFAULT_VALUE_FORMAT, editorialAnnotationSchema } from '@statsopedia/shared-schemas';
import type { EditorialAnnotation, NormalizedDataset } from '@statsopedia/shared-types';
import {
  buildRaceConfig,
  computeRaceTimeline,
  createVideoConfiguration,
  planRaceRender,
} from '@statsopedia/video-config';
import { describe, expect, it } from 'vitest';

import fixture from '../../shared-schemas/test/fixtures/normalized-dataset.json' with { type: 'json' };
import {
  buildCredits,
  buildRaceData,
  checkRaceQuality,
  compactSourceLabel,
  computeRaceLayout,
  contrastRatio,
  endCardFrames,
  finalStandings,
  planAnnotations,
  suggestAnnotations,
  type QualityMusicAsset,
} from '../src/index.js';

const dataset = fixture as NormalizedDataset;
const data = buildRaceData(dataset, { startPeriod: null, endPeriod: null }, () => '#000000');
const timing = {
  secondsPerPeriod: 2,
  transitionSeconds: 1.6,
  easing: 'easeInOut' as const,
  introSeconds: 2,
  outroSeconds: 4,
  finalHoldSeconds: 2,
  creditsSeconds: 4,
};
const timeline = computeRaceTimeline(timing, { fps: 30, periodCount: data.periods.length });
const landscape = computeRaceLayout({ width: 1920, height: 1080, topN: 5 });
const portrait = computeRaceLayout({ width: 1080, height: 1920, topN: 5 });

const note = (id: string, patch: Partial<EditorialAnnotation> = {}): EditorialAnnotation => ({
  id,
  kind: 'milestone',
  title: `Note ${id}`,
  text: null,
  icon: null,
  imageUrl: null,
  sources: [{ name: 'Example Atlas', url: 'https://example.org/atlas' }],
  timing: { kind: 'period', period: '2017', durationSeconds: 3 },
  priority: 'normal',
  style: 'card',
  position: 'auto',
  ...patch,
});

const plan = (annotations: EditorialAnnotation[], layout = landscape) =>
  planAnnotations({ annotations, data, timeline, layout, topN: 5 });

describe('planAnnotations', () => {
  it('puts auto notes in the corner that covers the fewest bars, never over the leaders', () => {
    const auto = plan([note('a')]).placed[0]!;
    const corners = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(
      (position) => plan([note('b', { position })]).placed[0]!,
    );
    expect(auto.coveredRanks.length).toBe(Math.min(...corners.map((c) => c.coveredRanks.length)));
    expect(auto.coveredRanks).not.toContain(1);
    expect(corners[1]!.slot).toBe('top-right');
    expect(corners[1]!.coveredRanks).toContain(1);
    // With room beside short bars (top 10 of a 5-entity race), nothing is covered.
    const roomy = planAnnotations({
      annotations: [note('c')],
      data,
      timeline,
      layout: computeRaceLayout({ width: 1920, height: 1080, topN: 10 }),
      topN: 10,
    });
    expect(roomy.placed[0]!.coveredRanks).toEqual([]);
  });

  it('gives the place to the higher priority note and delays the other', () => {
    const low = note('low', { position: 'bottom-right', priority: 'low' });
    const high = note('high', {
      position: 'bottom-right',
      priority: 'high',
      timing: { kind: 'period', period: '2017', durationSeconds: 2 },
    });
    const { placed, skipped } = plan([low, high]);
    expect(skipped).toEqual([]);
    const byId = Object.fromEntries(placed.map((p) => [p.annotation.id, p]));
    expect(byId.high!.deferredFrames).toBe(0);
    expect(byId.low!.from).toBe(byId.high!.from + byId.high!.durationInFrames);
    expect(byId.low!.deferredFrames).toBe(60);
    // Higher priority is drawn last (on top).
    expect(placed.at(-1)!.annotation.id).toBe('high');
  });

  it('uses another free corner instead of waiting when the position is auto', () => {
    const { placed } = plan([note('a'), note('b')]);
    expect(placed.map((p) => p.deferredFrames)).toEqual([0, 0]);
    expect(new Set(placed.map((p) => p.slot)).size).toBe(2);
  });

  it('has one place in portrait, and skips notes that cannot fit before the race ends', () => {
    const lastPeriod = data.periods.at(-1)!;
    const long = note('long', {
      priority: 'high',
      timing: { kind: 'period', period: lastPeriod, durationSeconds: 60 },
    });
    const late = note('late', {
      timing: { kind: 'period', period: lastPeriod, durationSeconds: 2 },
    });
    const { placed, skipped } = plan([long, late], portrait);
    expect(placed.map((p) => [p.annotation.id, p.slot])).toEqual([['long', 'header']]);
    expect(placed[0]!.clipped).toBe(true);
    expect(skipped).toEqual([{ annotation: late, reason: 'no_room' }]);
  });

  it('skips notes outside the race', () => {
    const outside = note('x', { timing: { kind: 'time', startSeconds: 0, endSeconds: 1.5 } });
    expect(plan([outside]).skipped).toEqual([{ annotation: outside, reason: 'outside' }]);
  });
});

describe('credits and outro', () => {
  it('lists data sources, new annotation sources and the music credit once each', () => {
    const credits = buildCredits(dataset, {
      annotations: [
        note('a'),
        note('b'),
        note('c', {
          sources: [{ name: 'statsopedia-synthetic', url: 'https://example.org/synthetic' }],
        }),
      ],
      music: {
        src: 'a.mp3',
        volume: 0.5,
        fadeInSeconds: 1,
        fadeOutSeconds: 1,
        loop: true,
        durationSeconds: 30,
        attribution: 'Pad by Example',
      },
    });
    expect(credits).toEqual({
      data: [{ name: 'statsopedia-synthetic', url: 'https://example.org/synthetic' }],
      editorial: [{ name: 'Example Atlas', url: 'https://example.org/atlas' }],
      music: 'Pad by Example',
    });
    expect(compactSourceLabel(dataset, { sourceText: null })).toBe('Source: statsopedia-synthetic');
    expect(compactSourceLabel(dataset, { sourceText: 'Source: IMF' })).toBe('Source: IMF');
  });

  it('ranks the final period, best first', () => {
    const standings = finalStandings(data, 3);
    expect(standings).toHaveLength(3);
    expect(standings.map((s) => s.rank)).toEqual([...standings.map((s) => s.rank)].sort());
    expect(standings[0]!.rank).toBe(1);
  });

  it('splits the outro into the final ranking and the end card when there is time', () => {
    expect(endCardFrames(120, 30)).toBe(48);
    expect(endCardFrames(60, 30)).toBe(0);
    expect(endCardFrames(600, 30)).toBe(90);
  });
});

describe('checkRaceQuality', () => {
  const base = createVideoConfiguration({
    title: 'Synthetic ranking',
    datasetVersionId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
    templateId: '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c',
    topN: 5,
  });
  const asset: QualityMusicAsset = {
    name: 'Pad',
    durationSeconds: 8,
    audio: {
      codec: 'mp3',
      sampleRate: 44_100,
      channels: 2,
      truePeakDbtp: -0.2,
      integratedLufs: -14,
    },
    commercialUse: true,
    attributionRequired: true,
    attribution: 'Pad by Example (CC BY 4.0)',
  };
  const music = {
    src: 'a.mp3',
    durationSeconds: 8,
    truePeakDbtp: -0.2,
    attribution: asset.attribution,
  };
  const run = (
    configuration = base,
    options: { musicAsset?: QualityMusicAsset | null; format?: 'long' | 'short' } = {},
  ) => {
    const musicAsset = options.musicAsset === undefined ? null : options.musicAsset;
    const config = buildRaceConfig(configuration, {
      format: options.format ?? 'long',
      kind: 'final',
      music:
        configuration.music && musicAsset
          ? { ...music, durationSeconds: musicAsset.durationSeconds }
          : null,
    });
    return checkRaceQuality({
      props: { dataset, config },
      kind: 'final',
      requestedVolume: configuration.music?.volume ?? null,
      musicAsset,
    });
  };
  const status = (report: ReturnType<typeof run>, id: string) =>
    report.checks.find((check) => check.id === id)?.status;

  it('passes a plain configuration', () => {
    const report = run();
    expect(report.checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(report.status).toBe('pass');
  });

  it('refuses a short track without looping, and lowers hot masters', () => {
    const withMusic = {
      ...base,
      music: {
        assetId: base.templateId,
        volume: 1,
        fadeInSeconds: 1,
        fadeOutSeconds: 2,
        loop: false,
      },
    };
    const short = run(withMusic, { musicAsset: asset });
    expect(status(short, 'music_coverage')).toBe('fail');
    expect(short.status).toBe('fail');
    const looped = run(
      { ...withMusic, music: { ...withMusic.music, loop: true } },
      { musicAsset: asset },
    );
    expect(status(looped, 'music_coverage')).toBe('pass');
    const clipping = looped.checks.find((c) => c.id === 'music_clipping')!;
    expect(clipping.detail).toMatch(/lowered from 100% to 91%/);
    expect(status(looped, 'music_audible')).toBe('pass');
  });

  it('refuses music that may not be used commercially, and silent or muted music', () => {
    const withMusic = {
      ...base,
      music: {
        assetId: base.templateId,
        volume: 0.5,
        fadeInSeconds: 1,
        fadeOutSeconds: 2,
        loop: true,
      },
    };
    expect(
      status(run(withMusic, { musicAsset: { ...asset, commercialUse: false } }), 'music_license'),
    ).toBe('fail');
    expect(
      status(
        run(withMusic, {
          musicAsset: {
            ...asset,
            audio: { ...asset.audio!, integratedLufs: null, truePeakDbtp: null },
          },
        }),
        'music_audible',
      ),
    ).toBe('fail');
    expect(
      status(
        run({ ...withMusic, music: { ...withMusic.music, volume: 0 } }, { musicAsset: asset }),
        'music_audible',
      ),
    ).toBe('fail');
    expect(
      status(
        run(
          { ...withMusic, music: { ...withMusic.music, fadeOutSeconds: 0 } },
          { musicAsset: asset },
        ),
        'music_fades',
      ),
    ).toBe('warn');
  });

  it('needs a visible place for the music credit', () => {
    const report = run(
      {
        ...base,
        outro: { ...base.outro, enabled: false },
        credits: { ...base.credits, enabled: false },
        music: {
          assetId: base.templateId,
          volume: 0.5,
          fadeInSeconds: 1,
          fadeOutSeconds: 2,
          loop: true,
        },
      },
      { musicAsset: asset },
    );
    expect(status(report, 'source_credits')).toBe('fail');
  });

  it('reports annotations over the bars, unplaceable notes and unsourced figures', () => {
    const report = run({
      ...base,
      annotations: [
        note('over', { position: 'top-left' }),
        note('cap', {
          kind: 'caption',
          sources: [],
          title: 'Up 40% since 2015',
          position: 'bottom-right',
        }),
      ],
    });
    expect(status(report, 'annotation_overlap')).toBe('warn');
    expect(status(report, 'annotation_sources')).toBe('warn');
  });

  it('refuses Shorts longer than YouTube allows', () => {
    const periods = Array.from({ length: 100 }, (_, i) => String(1900 + i));
    const long = { ...dataset, timeRange: { ...dataset.timeRange, periods } };
    const config = buildRaceConfig(
      { ...base, animationSpeed: 'slow' },
      { format: 'short', kind: 'final', music: null },
    );
    const render = planRaceRender({ dataset: long, config });
    expect(render.durationInFrames / render.fps).toBeGreaterThan(180);
    const report = checkRaceQuality({
      props: { dataset: long, config },
      kind: 'final',
      requestedVolume: null,
      musicAsset: null,
    });
    expect(status(report, 'scene_timing')).toBe('fail');
    expect(status(run(base, { format: 'short' }), 'scene_timing')).toBe('pass');
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});

describe('suggestAnnotations', () => {
  it('reads lead changes, entries, moves and the winner from the data, citing its sources', () => {
    const suggestions = suggestAnnotations(dataset, {
      startPeriod: null,
      endPeriod: null,
      topN: 3,
      valueFormat: DEFAULT_VALUE_FORMAT,
    });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(editorialAnnotationSchema.safeParse(suggestion).success).toBe(true);
      expect(suggestion.kind).not.toBe('milestone');
      expect(suggestion.sources).toEqual([
        { name: 'statsopedia-synthetic', url: 'https://example.org/synthetic' },
      ]);
    }
    const winner = suggestions.find((s) => s.kind === 'winner')!;
    const top = finalStandings(data, 1)[0]!;
    expect(winner.title).toBe(`${top.entity.name} finishes #1`);
    expect(winner.timing).toMatchObject({ period: '2020' });
    expect(new Set(suggestions.map((s) => s.id)).size).toBe(suggestions.length);
  });

  it('suggests nothing for a dataset without sources', () => {
    expect(
      suggestAnnotations(
        { ...dataset, sources: [] },
        { startPeriod: null, endPeriod: null, topN: 3, valueFormat: DEFAULT_VALUE_FORMAT },
      ),
    ).toEqual([]);
  });
});
