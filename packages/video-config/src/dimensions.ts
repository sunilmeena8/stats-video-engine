import type { OutputFormat, ResolutionPreset } from '@statsopedia/shared-types';

export interface Dimensions {
  width: number;
  height: number;
}

/** Long and short edge, in pixels, for each resolution tier. */
const RESOLUTION_EDGES: Record<ResolutionPreset, { longEdge: number; shortEdge: number }> = {
  '720p': { longEdge: 1280, shortEdge: 720 },
  '1080p': { longEdge: 1920, shortEdge: 1080 },
  '1440p': { longEdge: 2560, shortEdge: 1440 },
  '2160p': { longEdge: 3840, shortEdge: 2160 },
};

export const ASPECT_RATIOS: Record<OutputFormat, '16:9' | '9:16'> = {
  long: '16:9',
  short: '9:16',
};

/** Pixel size of a render: landscape for long-form videos, portrait for Shorts. */
export function resolveDimensions(format: OutputFormat, resolution: ResolutionPreset): Dimensions {
  const { longEdge, shortEdge } = RESOLUTION_EDGES[resolution];
  return format === 'long'
    ? { width: longEdge, height: shortEdge }
    : { width: shortEdge, height: longEdge };
}
