import type { ReactElement } from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';

import { BarChartRaceComposition } from './compositions/bar-chart-race/BarChartRaceComposition';
import { SAMPLE_RACE_PROPS } from './compositions/bar-chart-race/sample-config';
import {
  resolveBarChartRaceMetadata,
  type RaceCompositionProps,
} from './compositions/bar-chart-race/schema';
import { SampleComposition } from './compositions/sample/SampleComposition';
import { resolveSampleMetadata, type SampleCompositionProps } from './compositions/sample/schema';

const calculateSampleMetadata: CalculateMetadataFunction<SampleCompositionProps> = ({ props }) =>
  resolveSampleMetadata(props);

const calculateRaceMetadata: CalculateMetadataFunction<RaceCompositionProps> = ({ props }) =>
  resolveBarChartRaceMetadata(props);

const sampleDefaults = {
  resolution: '1080p',
  fps: 30,
  theme: 'midnight',
  animationSpeed: 'normal',
  topN: 6,
  title: 'Sample Ranking',
  subtitle: 'Synthetic data · 2018–2023',
} as const satisfies Omit<SampleCompositionProps, 'outputFormat'>;

/**
 * Registers every composition. Dimensions, fps and duration come from `calculateMetadata`,
 * which validates the input props; the static values below are placeholders it overrides.
 */
export function RemotionRoot(): ReactElement {
  return (
    <>
      <Composition
        id="BarChartRace"
        component={BarChartRaceComposition}
        defaultProps={SAMPLE_RACE_PROPS}
        calculateMetadata={calculateRaceMetadata}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={1}
      />
      <Composition
        id="BarChartRaceShort"
        component={BarChartRaceComposition}
        defaultProps={{
          ...SAMPLE_RACE_PROPS,
          config: { ...SAMPLE_RACE_PROPS.config, outputFormat: 'short', topN: 8 },
        }}
        calculateMetadata={calculateRaceMetadata}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
      />
      <Composition
        id="SampleLong"
        component={SampleComposition}
        defaultProps={{ ...sampleDefaults, outputFormat: 'long' }}
        calculateMetadata={calculateSampleMetadata}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={1}
      />
      <Composition
        id="SampleShort"
        component={SampleComposition}
        defaultProps={{ ...sampleDefaults, outputFormat: 'short' }}
        calculateMetadata={calculateSampleMetadata}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
      />
    </>
  );
}
