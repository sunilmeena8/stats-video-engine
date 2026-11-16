import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  SAMPLE_END_YEAR,
  SAMPLE_ENTITIES,
  SAMPLE_SNAPSHOTS,
  SAMPLE_START_YEAR,
} from '../src/compositions/sample/sample-data';
import { resolveSampleMetadata } from '../src/compositions/sample/schema';

const props = {
  outputFormat: 'long',
  resolution: '1080p',
  fps: 30,
  theme: 'midnight',
  animationSpeed: 'normal',
  topN: 6,
  title: 'Sample Ranking',
  subtitle: '',
};

describe('resolveSampleMetadata', () => {
  it('derives 16:9 dimensions and duration for long-form', () => {
    const metadata = resolveSampleMetadata(props);
    expect(metadata).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    // 2.5s intro + 5 year steps × 36 frames + 2s hold + 2.5s outro at 30fps.
    expect(metadata.durationInFrames).toBe(75 + 5 * 36 + 60 + 75);
  });

  it('derives 9:16 dimensions for Shorts', () => {
    expect(resolveSampleMetadata({ ...props, outputFormat: 'short' })).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('rejects invalid input props before rendering', () => {
    expect(() => resolveSampleMetadata({ ...props, theme: 'neon' })).toThrow(ZodError);
    expect(() => resolveSampleMetadata({ ...props, topN: 50 })).toThrow(ZodError);
  });
});

describe('sample data', () => {
  it('has one snapshot per year with a value for every entity', () => {
    expect(SAMPLE_SNAPSHOTS).toHaveLength(SAMPLE_END_YEAR - SAMPLE_START_YEAR + 1);
    for (const snapshot of SAMPLE_SNAPSHOTS) {
      expect([...snapshot.keys()].sort()).toEqual(SAMPLE_ENTITIES.map((e) => e.id).sort());
    }
  });
});
