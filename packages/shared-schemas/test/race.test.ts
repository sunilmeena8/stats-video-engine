import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RACE_TIMING,
  DEFAULT_VALUE_FORMAT,
  editorialAnnotationSchema,
  raceTimingSchema,
  valueFormatSchema,
} from '../src/index.js';

describe('race config schemas', () => {
  it('requires a currency code for currency formats and a known locale', () => {
    expect(valueFormatSchema.safeParse(DEFAULT_VALUE_FORMAT).success).toBe(true);
    expect(
      valueFormatSchema.safeParse({ ...DEFAULT_VALUE_FORMAT, style: 'currency' }).success,
    ).toBe(false);
    expect(
      valueFormatSchema.safeParse({ ...DEFAULT_VALUE_FORMAT, style: 'currency', currency: 'USD' })
        .success,
    ).toBe(true);
    expect(
      valueFormatSchema.safeParse({ ...DEFAULT_VALUE_FORMAT, locale: 'not a locale!' }).success,
    ).toBe(false);
  });

  it('keeps transitions within a period', () => {
    expect(raceTimingSchema.safeParse(DEFAULT_RACE_TIMING).success).toBe(true);
    expect(
      raceTimingSchema.safeParse({ ...DEFAULT_RACE_TIMING, transitionSeconds: 9 }).success,
    ).toBe(false);
  });

  it('accepts period- or frame-anchored annotations and safe image sources only', () => {
    const base = {
      id: 'a',
      kind: 'milestone',
      title: 'Milestone',
      text: null,
      icon: null,
      imageUrl: null,
      sources: [{ name: 'World Bank', url: 'https://data.worldbank.org' }],
      priority: 'normal',
      style: 'card',
      position: 'bottom-right',
    };
    expect(
      editorialAnnotationSchema.safeParse({
        ...base,
        timing: { kind: 'period', period: '2001', durationSeconds: 3 },
      }).success,
    ).toBe(true);
    expect(
      editorialAnnotationSchema.safeParse({
        ...base,
        timing: { kind: 'frames', startFrame: 50, endFrame: 10 },
      }).success,
    ).toBe(false);
    const withImage = (imageUrl: string) =>
      editorialAnnotationSchema.safeParse({
        ...base,
        imageUrl,
        timing: { kind: 'frames', startFrame: 0, endFrame: 10 },
      }).success;
    expect(withImage('images/milestone.png')).toBe(true);
    expect(withImage('https://example.org/x.png')).toBe(true);
    expect(withImage('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(withImage('../../secrets.png')).toBe(false);
    expect(withImage('file:///etc/passwd')).toBe(false);
    expect(withImage('javascript:alert(1)')).toBe(false);
  });

  it('requires a source for every fact; only captions may have none', () => {
    const annotation = {
      id: 'a',
      kind: 'milestone',
      title: '2008 financial crisis',
      text: null,
      icon: null,
      imageUrl: null,
      sources: [],
      priority: 'high',
      style: 'card',
      position: 'auto',
      timing: { kind: 'time', startSeconds: 5, endSeconds: 9 },
    };
    const result = editorialAnnotationSchema.safeParse(annotation);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sources']);
    expect(editorialAnnotationSchema.safeParse({ ...annotation, kind: 'caption' }).success).toBe(
      true,
    );
    expect(
      editorialAnnotationSchema.safeParse({
        ...annotation,
        sources: [{ name: 'IMF', url: 'ftp://imf.org' }],
      }).success,
    ).toBe(false);
    // Too short to read.
    expect(
      editorialAnnotationSchema.safeParse({
        ...annotation,
        kind: 'caption',
        timing: { kind: 'time', startSeconds: 5, endSeconds: 5.5 },
      }).success,
    ).toBe(false);
  });
});
