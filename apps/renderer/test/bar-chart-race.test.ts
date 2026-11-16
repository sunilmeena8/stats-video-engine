import type { BarChartRaceConfig } from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import { SAMPLE_RACE_PROPS } from '../src/compositions/bar-chart-race/sample-config';
import { resolveBarChartRaceMetadata } from '../src/compositions/bar-chart-race/schema';

const withConfig = (overrides: Partial<BarChartRaceConfig>) => ({
  ...SAMPLE_RACE_PROPS,
  config: { ...SAMPLE_RACE_PROPS.config, ...overrides },
});

describe('BarChartRace metadata', () => {
  it('renders the synthetic sample at 1920x1080, 30 fps, with a duration from the timeline', () => {
    const metadata = resolveBarChartRaceMetadata(SAMPLE_RACE_PROPS);
    // 3 s intro + 34 transitions × 42 frames + 3 s final hold + 3 s outro + 4 s credits.
    expect(metadata).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 1698 + 120,
    });
  });

  it('sizes Shorts and other resolutions from the config', () => {
    expect(resolveBarChartRaceMetadata(withConfig({ outputFormat: 'short' }))).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(resolveBarChartRaceMetadata(withConfig({ resolution: '2160p', fps: 60 }))).toMatchObject(
      { width: 3840, height: 2160, fps: 60 },
    );
  });

  it('renders a sub-range of periods', () => {
    const { durationInFrames } = resolveBarChartRaceMetadata(
      withConfig({ startPeriod: '2000', endPeriod: '2010' }),
    );
    expect(durationInFrames).toBe(90 + 10 * 42 + 90 + 90 + 120);
  });

  it('rejects invalid input before rendering', () => {
    expect(() => resolveBarChartRaceMetadata(withConfig({ startPeriod: '1850' }))).toThrow(
      /not in the dataset/,
    );
    expect(() =>
      resolveBarChartRaceMetadata(withConfig({ startPeriod: '2010', endPeriod: '2000' })),
    ).toThrow(/after startPeriod/);
    expect(() =>
      resolveBarChartRaceMetadata(
        withConfig({ timing: { ...SAMPLE_RACE_PROPS.config.timing, transitionSeconds: 5 } }),
      ),
    ).toThrow(/transitionSeconds/);
    expect(() =>
      resolveBarChartRaceMetadata(
        withConfig({
          music: {
            src: 'audio/x.wav',
            volume: 1.5,
            fadeInSeconds: 1,
            fadeOutSeconds: 1,
            loop: true,
            durationSeconds: 20,
            attribution: null,
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      resolveBarChartRaceMetadata(
        withConfig({
          music: {
            src: '/etc/passwd',
            volume: 0.5,
            fadeInSeconds: 1,
            fadeOutSeconds: 1,
            loop: true,
            durationSeconds: 20,
            attribution: null,
          },
        }),
      ),
    ).toThrow(/public directory/);
    expect(() => resolveBarChartRaceMetadata({ config: SAMPLE_RACE_PROPS.config })).toThrow();
  });
});
