import {
  RENDER_JOB_STATUSES,
  canTransitionRenderJob,
  type VideoConfiguration,
} from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_VALUE_FORMAT,
  createDatasetRequestSchema,
  csvKeySchema,
  dataPointSchema,
  datasetPeriodSchema,
  healthResponseSchema,
  processingOptionsSchema,
  isSafeRelativePath,
  mediaUploadQuerySchema,
  renderJobPayloadSchema,
  storageRelativePathSchema,
  videoConfigurationSchema,
} from '../src/index.js';

const validConfiguration: VideoConfiguration = {
  title: 'Top 10 Economies 1960–2023',
  description: 'GDP ranking by country.',
  datasetVersionId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
  templateId: '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c',
  startPeriod: '1960',
  endPeriod: null,
  topN: 10,
  animationSpeed: 'normal',
  theme: 'midnight',
  outputMode: 'both',
  music: null,
  fps: 30,
  resolution: '1080p',
  intro: { enabled: true, durationSeconds: 3, title: null, subtitle: null },
  outro: { enabled: true, durationSeconds: 4, text: 'Subscribe for more rankings' },
  credits: { enabled: true, durationSeconds: 4, showUrls: true },
  metricLabel: null,
  metricDescription: null,
  unitLabel: null,
  valueFormat: DEFAULT_VALUE_FORMAT,
  showLogos: true,
  markEstimates: true,
  sourceText: null,
  annotations: [],
};

describe('videoConfigurationSchema', () => {
  it('accepts a complete, valid configuration', () => {
    expect(videoConfigurationSchema.parse(validConfiguration)).toEqual(validConfiguration);
  });

  it('accepts monthly and daily periods and rejects malformed ones', () => {
    const ok = (startPeriod: string) =>
      videoConfigurationSchema.safeParse({ ...validConfiguration, startPeriod }).success;
    expect(ok('2020-03')).toBe(true);
    expect(ok('2020-03-15')).toBe(true);
    expect(ok('March 2020')).toBe(false);
  });

  it('accepts only long, short or both output modes, and rejects unknown fields', () => {
    expect(
      videoConfigurationSchema.safeParse({ ...validConfiguration, outputMode: 'square' }).success,
    ).toBe(false);
    expect(
      videoConfigurationSchema.safeParse({ ...validConfiguration, outputFormats: ['long'] })
        .success,
    ).toBe(false);
  });

  it('never amplifies music', () => {
    const music = {
      assetId: validConfiguration.templateId,
      volume: 1.5,
      fadeInSeconds: 1,
      fadeOutSeconds: 1,
      loop: true,
    };
    expect(videoConfigurationSchema.safeParse({ ...validConfiguration, music }).success).toBe(
      false,
    );
  });

  it('rejects unsupported fps values and out-of-range topN', () => {
    expect(videoConfigurationSchema.safeParse({ ...validConfiguration, fps: 29 }).success).toBe(
      false,
    );
    expect(videoConfigurationSchema.safeParse({ ...validConfiguration, topN: 21 }).success).toBe(
      false,
    );
  });

  it('enforces the YouTube title limit', () => {
    const result = videoConfigurationSchema.safeParse({
      ...validConfiguration,
      title: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('requires a positive duration for an enabled intro', () => {
    const result = videoConfigurationSchema.safeParse({
      ...validConfiguration,
      intro: { ...validConfiguration.intro, durationSeconds: 0 },
    });
    expect(result.success).toBe(false);
  });
});

describe('renderJobPayloadSchema', () => {
  const payload = {
    renderJobId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
    requestId: '1c8e7d3f-69a5-4d5c-8b9f-6e2a3b4c5d6e',
    projectId: '2d9f8e4a-7ab6-4e6d-9cad-7f3b4c5d6e7f',
    kind: 'final',
    outputFormat: 'long',
  };

  it('carries identifiers only', () => {
    expect(renderJobPayloadSchema.safeParse(payload).success).toBe(true);
    // Props, paths and composition ids come from PostgreSQL, never from the queue.
    expect(renderJobPayloadSchema.safeParse({ ...payload, inputProps: {} }).success).toBe(false);
    expect(
      renderJobPayloadSchema.safeParse({ ...payload, outputKey: '../../etc/passwd' }).success,
    ).toBe(false);
    expect(renderJobPayloadSchema.safeParse({ ...payload, renderJobId: 'x' }).success).toBe(false);
  });
});

describe('render job transitions', () => {
  it('only moves forward one stage, and never out of a finished state', () => {
    expect(canTransitionRenderJob('pending', 'validating')).toBe(true);
    expect(canTransitionRenderJob('validating', 'preparing')).toBe(true);
    expect(canTransitionRenderJob('rendering', 'post_processing')).toBe(true);
    expect(canTransitionRenderJob('post_processing', 'completed')).toBe(true);
    expect(canTransitionRenderJob('rendering', 'rendering')).toBe(true);
    expect(canTransitionRenderJob('pending', 'rendering')).toBe(false);
    expect(canTransitionRenderJob('rendering', 'completed')).toBe(false);
    // A retry waits as pending; a new attempt (e.g. after a crash) restarts at validating.
    expect(canTransitionRenderJob('rendering', 'pending')).toBe(true);
    expect(canTransitionRenderJob('post_processing', 'validating')).toBe(true);
    for (const to of RENDER_JOB_STATUSES) {
      expect(canTransitionRenderJob('failed', to)).toBe(false);
      expect(canTransitionRenderJob('cancelled', to)).toBe(false);
      expect(canTransitionRenderJob('completed', to)).toBe(false);
    }
  });
});

describe('storage paths', () => {
  it.each(['datasets/gdp.csv', 'renders/long/abc.mp4', 'a/b/c'])('accepts %s', (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it.each(['/etc/passwd', '../secrets', 'datasets/../../x', 'C:\\x', '\\\\server\\share', 'a\0b'])(
    'rejects %s',
    (path) => {
      expect(storageRelativePathSchema.safeParse(path).success).toBe(false);
    },
  );
});

describe('dataPointSchema', () => {
  const base = {
    datasetVersionId: '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d',
    entityId: '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c',
    period: '2000',
    year: 2000,
    dataSourceId: '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b',
    sourceRow: 2,
    notes: null,
  };

  it('rejects non-finite values', () => {
    expect(dataPointSchema.safeParse({ ...base, value: 1.5 }).success).toBe(true);
    expect(dataPointSchema.safeParse({ ...base, value: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
    expect(dataPointSchema.safeParse({ ...base, value: Number.NaN }).success).toBe(false);
  });

  it('accepts a missing value as null, never as a coerced number', () => {
    expect(dataPointSchema.safeParse({ ...base, value: null }).success).toBe(true);
    expect(dataPointSchema.safeParse({ ...base, value: '' }).success).toBe(false);
  });
});

describe('dataset periods and CSV keys', () => {
  it.each(['2020', '-500', '1', '2020-03', '2020-03-15'])('accepts period %s', (period) => {
    expect(datasetPeriodSchema.safeParse(period).success).toBe(true);
  });

  it.each(['2020.0', '20-03', '2020/03/15', '2020-3', '', 'year 2020'])(
    'rejects period %s',
    (period) => {
      expect(datasetPeriodSchema.safeParse(period).success).toBe(false);
    },
  );

  it('keeps CSV ids exactly but rejects padding and control characters', () => {
    expect(csvKeySchema.safeParse('USA').success).toBe(true);
    expect(csvKeySchema.safeParse('Côte d’Ivoire, Rep.').success).toBe(true);
    expect(csvKeySchema.safeParse(' USA').success).toBe(false);
    expect(csvKeySchema.safeParse('US\nA').success).toBe(false);
  });
});

describe('createDatasetRequestSchema', () => {
  it('accepts partial configuration and rejects unknown fields', () => {
    expect(
      createDatasetRequestSchema.safeParse({
        title: 'GDP',
        metric: { rankingOrder: 'asc' },
        processing: { interpolation: { stepsPerPeriod: 4 } },
      }).success,
    ).toBe(true);
    expect(createDatasetRequestSchema.safeParse({ title: 'GDP', admin: true }).success).toBe(false);
    expect(createDatasetRequestSchema.safeParse({ title: '  ' }).success).toBe(false);
  });

  it('bounds top N and interpolation steps', () => {
    expect(
      processingOptionsSchema.safeParse({ ...DEFAULT_PROCESSING_OPTIONS, topN: 0 }).success,
    ).toBe(false);
    expect(
      processingOptionsSchema.safeParse({
        ...DEFAULT_PROCESSING_OPTIONS,
        interpolation: { ...DEFAULT_PROCESSING_OPTIONS.interpolation, stepsPerPeriod: 61 },
      }).success,
    ).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('accepts Python-style UTC offsets in timestamps', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'data-processor',
      version: '0.1.0',
      uptimeSeconds: 1.2,
      timestamp: '2026-11-09T12:00:00.123456+00:00',
      checks: {},
    });
    expect(result.success).toBe(true);
  });
});

describe('mediaUploadQuerySchema', () => {
  const music = {
    type: 'music',
    filename: 'pad.mp3',
    category: 'ambient',
    licenseType: 'creative_commons',
    license: 'CC BY 4.0',
    commercialUse: 'true',
    attributionRequired: 'true',
    attribution: 'Pad by Example (CC BY 4.0)',
  };

  it('requires a category and licensing for music, and a credit line when attribution is due', () => {
    const parsed = mediaUploadQuerySchema.parse(music);
    expect(parsed).toMatchObject({ commercialUse: true, attributionRequired: true });
    const issues = (query: Record<string, string>) =>
      mediaUploadQuerySchema.safeParse(query).error?.issues.map((issue) => issue.path.join('.'));
    expect(issues({ ...music, category: undefined } as never)).toEqual(['category']);
    expect(issues({ type: 'music', filename: 'a.mp3' })).toEqual([
      'category',
      'licenseType',
      'commercialUse',
    ]);
    expect(issues({ ...music, attribution: '' })).toEqual(['attribution']);
    expect(issues({ ...music, category: 'polka' })).toEqual(['category']);
    // Images need none of it.
    expect(mediaUploadQuerySchema.safeParse({ type: 'image', filename: 'a.png' }).success).toBe(
      true,
    );
  });
});
