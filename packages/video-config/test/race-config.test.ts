import { describe, expect, it } from 'vitest';

import {
  buildRaceConfig,
  computeRaceTimeline,
  createVideoConfiguration,
  formatsForMode,
  planRaceRender,
  racePeriodCount,
  safeMusicGain,
} from '../src/index.js';

const configuration = createVideoConfiguration({
  title: 'Largest Economies',
  datasetVersionId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
  templateId: '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c',
  animationSpeed: 'slow',
  outputMode: 'both',
  music: {
    assetId: '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b',
    volume: 0.6,
    fadeInSeconds: 2,
    fadeOutSeconds: 3,
    loop: true,
  },
  intro: { subtitle: 'GDP, 2000–2010' },
  outro: { text: 'Subscribe for more rankings' },
});

describe('formatsForMode', () => {
  it('maps output modes to formats', () => {
    expect(formatsForMode('long')).toEqual(['long']);
    expect(formatsForMode('short')).toEqual(['short']);
    expect(formatsForMode('both')).toEqual(['long', 'short']);
  });
});

describe('buildRaceConfig', () => {
  it('maps the project configuration onto the renderer config', () => {
    const race = buildRaceConfig(
      { ...configuration, startPeriod: null, endPeriod: null },
      {
        format: 'short',
        kind: 'final',
        music: {
          src: 'storage:assets/music/pad.wav',
          durationSeconds: 20,
          truePeakDbtp: -6,
          attribution: 'Pad by Example (CC BY 4.0)',
        },
      },
    );
    expect(race).toMatchObject({
      title: 'Largest Economies',
      subtitle: 'GDP, 2000–2010',
      outputFormat: 'short',
      resolution: '1080p',
      outroText: 'Subscribe for more rankings',
      timing: { secondsPerPeriod: 2, transitionSeconds: 1.6, introSeconds: 3, outroSeconds: 4 },
      music: {
        src: 'storage:assets/music/pad.wav',
        volume: 0.6,
        loop: true,
        durationSeconds: 20,
        attribution: 'Pad by Example (CC BY 4.0)',
      },
      showSourceUrls: false,
    });
    expect(race.timing.creditsSeconds).toBe(4);
    // The result is always a valid renderer config, so the timeline accepts it.
    expect(
      computeRaceTimeline(race.timing, { fps: race.fps, periodCount: 5 }).durationInFrames,
    ).toBe(90 + 4 * 60 + 90 + 120 + 120);
  });

  it('lowers the volume of hot masters so the music stays under -1 dBTP', () => {
    const music = { src: 'a.wav', durationSeconds: 20, truePeakDbtp: 0, attribution: null };
    const loud = buildRaceConfig(
      { ...configuration, music: { ...configuration.music!, volume: 1 } },
      { format: 'long', kind: 'final', music },
    );
    expect(loud.music!.volume).toBeCloseTo(0.891, 3);
    // A quiet setting is already safe and is kept.
    const quiet = buildRaceConfig(configuration, { format: 'long', kind: 'final', music });
    expect(quiet.music!.volume).toBe(0.6);
    expect(safeMusicGain(-12)).toBe(1);
    expect(safeMusicGain(null)).toBe(1);
  });

  it('renders previews at 720p and drops disabled intros, outros and missing music', () => {
    const race = buildRaceConfig(
      { ...configuration, intro: { ...configuration.intro, enabled: false } },
      { format: 'long', kind: 'preview', music: null },
    );
    expect(race.resolution).toBe('720p');
    expect(race.timing.introSeconds).toBe(0);
    const noCredits = buildRaceConfig(
      { ...configuration, credits: { ...configuration.credits, enabled: false } },
      { format: 'long', kind: 'final', music: null },
    );
    expect(noCredits.timing.creditsSeconds).toBe(0);
    expect(race.music).toBeNull();
  });
});

describe('planRaceRender', () => {
  it('derives size, frames and thumbnail frame from the props', () => {
    const config = buildRaceConfig(
      { ...configuration, startPeriod: null, endPeriod: null },
      {
        format: 'short',
        kind: 'preview',
        music: null,
      },
    );
    const plan = planRaceRender({
      dataset: { timeRange: { periods: ['2000', '2001', '2002', '2003'] } } as never,
      config,
    });
    expect([plan.width, plan.height]).toEqual([720, 1280]);
    expect(plan.durationInFrames).toBe(plan.timeline.durationInFrames);
    expect(plan.thumbnailFrame).toBe(plan.timeline.outroStartFrame - 1);
    expect(racePeriodCount(['a', 'b', 'c', 'd'], { startPeriod: 'b', endPeriod: 'c' })).toBe(2);
    expect(() => racePeriodCount(['a'], { startPeriod: 'z', endPeriod: null })).toThrow();
  });
});
