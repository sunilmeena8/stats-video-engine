import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  DEFAULT_VIDEO_CONFIGURATION,
  VIDEO_THEMES,
  computeTimeline,
  createVideoConfiguration,
  paletteColor,
  resolveDimensions,
  yearPositionAtFrame,
} from '../src/index.js';

const required = {
  title: 'Largest Economies',
  datasetVersionId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
  templateId: '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c',
};

describe('createVideoConfiguration', () => {
  it('fills every optional field from the defaults', () => {
    const config = createVideoConfiguration(required);
    expect(config).toMatchObject({ ...required, ...DEFAULT_VIDEO_CONFIGURATION });
  });

  it('merges partial intro/outro overrides with the defaults', () => {
    const config = createVideoConfiguration({ ...required, intro: { subtitle: 'GDP, 2000–2010' } });
    expect(config.intro).toEqual({
      ...DEFAULT_VIDEO_CONFIGURATION.intro,
      subtitle: 'GDP, 2000–2010',
    });
  });

  it('validates the merged result', () => {
    expect(() => createVideoConfiguration({ ...required, topN: 50 })).toThrow(ZodError);
    expect(() => createVideoConfiguration({ ...required, startPeriod: 'March' })).toThrow(ZodError);
  });
});

describe('resolveDimensions', () => {
  it('returns landscape for long-form and portrait for Shorts', () => {
    expect(resolveDimensions('long', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(resolveDimensions('short', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(resolveDimensions('short', '2160p')).toEqual({ width: 2160, height: 3840 });
  });
});

describe('computeTimeline', () => {
  const base = {
    fps: 30 as const,
    startYear: 2000,
    endYear: 2005,
    animationSpeed: 'normal' as const,
    intro: { enabled: true, durationSeconds: 3, title: null, subtitle: null },
    outro: { enabled: true, durationSeconds: 4, text: null },
  };

  it('lays out intro, chart and outro back to back', () => {
    const timeline = computeTimeline(base);
    expect(timeline).toEqual({
      fps: 30,
      yearSteps: 5,
      framesPerYear: 36,
      introFrames: 90,
      chartStartFrame: 90,
      chartFrames: 5 * 36 + 60,
      outroStartFrame: 90 + 240,
      outroFrames: 120,
      durationInFrames: 90 + 240 + 120,
    });
  });

  it('drops disabled bookends', () => {
    const timeline = computeTimeline({
      ...base,
      intro: { ...base.intro, enabled: false },
      outro: { ...base.outro, enabled: false },
    });
    expect(timeline.introFrames).toBe(0);
    expect(timeline.outroFrames).toBe(0);
    expect(timeline.durationInFrames).toBe(timeline.chartFrames);
  });

  it('maps chart frames to year steps and holds the final year', () => {
    const timeline = computeTimeline(base);
    expect(yearPositionAtFrame(timeline, 0)).toEqual({ stepIndex: 0, progress: 0 });
    expect(yearPositionAtFrame(timeline, 54)).toEqual({ stepIndex: 1, progress: 0.5 });
    expect(yearPositionAtFrame(timeline, 5 * 36 + 10)).toEqual({ stepIndex: 5, progress: 0 });
  });

  it('rejects ranges without at least one year step', () => {
    expect(() => computeTimeline({ ...base, endYear: 2000 })).toThrow(RangeError);
  });
});

describe('themes', () => {
  it('assigns palette colors by stable entity index, repeating past the palette length', () => {
    const theme = VIDEO_THEMES.midnight;
    expect(paletteColor(theme, 0)).toBe(theme.barPalette[0]);
    expect(paletteColor(theme, theme.barPalette.length)).toBe(theme.barPalette[0]);
  });
});
