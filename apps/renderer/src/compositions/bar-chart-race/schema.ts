import { barChartRacePropsSchema } from '@statsopedia/shared-schemas';
import type { BarChartRaceConfig, NormalizedDataset } from '@statsopedia/shared-types';
import { planRaceRender } from '@statsopedia/video-config';

export { barChartRacePropsSchema };

/**
 * `BarChartRaceProps` from shared-types, as a type alias: Remotion requires composition props
 * to be assignable to `Record<string, unknown>`, which interfaces are not.
 */
export type RaceCompositionProps = { dataset: NormalizedDataset; config: BarChartRaceConfig };

/**
 * Validates the props and derives size, frame rate and duration. Called by Remotion before
 * rendering, so invalid input fails the render with a precise error instead of a broken video.
 * The API and the render worker check their frame counts with the same `planRaceRender`.
 */
export function resolveBarChartRaceMetadata(rawProps: unknown) {
  const props = barChartRacePropsSchema.parse(rawProps);
  const { width, height, fps, durationInFrames } = planRaceRender(props);
  return { props, width, height, fps, durationInFrames };
}
