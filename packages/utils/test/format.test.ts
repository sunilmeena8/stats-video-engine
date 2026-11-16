import type { ValueFormat } from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import { formatValue } from '../src/index.js';

const base: ValueFormat = {
  style: 'number',
  currency: null,
  scale: 'none',
  scaleLabel: 'short',
  decimals: null,
  percentInput: 'fraction',
  prefix: '',
  suffix: '',
  locale: 'en-US',
};
const f = (value: number, overrides: Partial<ValueFormat> = {}) =>
  formatValue(value, { ...base, ...overrides });

describe('formatValue', () => {
  it('formats USD and other currencies, with the symbol where the locale puts it', () => {
    expect(f(1234.5, { style: 'currency', currency: 'USD', decimals: 2 })).toBe('$1,234.50');
    expect(f(1_234_000_000, { style: 'currency', currency: 'USD', scale: 'auto' })).toBe('$1.23B');
    expect(f(98_700, { style: 'currency', currency: 'JPY', decimals: 0 })).toBe('¥98,700');
    expect(
      f(2_500_000, { style: 'currency', currency: 'EUR', scale: 'auto', locale: 'de-DE' }),
    ).toBe('2,50M €');
  });

  it('formats percentages from fractions or points', () => {
    expect(f(0.2534, { style: 'percent' })).toBe('25.3%');
    expect(f(25.34, { style: 'percent', percentInput: 'points', decimals: 2 })).toBe('25.34%');
    expect(f(0.05, { style: 'percent', decimals: 0 })).toBe('5%');
  });

  it('formats integers without decimals', () => {
    expect(f(1_234_567.89, { style: 'integer' })).toBe('1,234,568');
    expect(f(-42.4, { style: 'integer' })).toBe('-42');
  });

  it('scales thousands, millions, billions and trillions', () => {
    expect(f(12_345, { scale: 'auto' })).toBe('12.3K');
    expect(f(4_560_000, { scale: 'millions' })).toBe('4.56M');
    expect(f(4_560_000, { scale: 'millions', scaleLabel: 'long' })).toBe('4.56 million');
    expect(f(987_000_000_000, { scale: 'auto' })).toBe('987B');
    expect(f(21_400_000_000_000, { style: 'currency', currency: 'USD', scale: 'auto' })).toBe(
      '$21.4T',
    );
    expect(f(1_500_000_000_000, { scale: 'auto', scaleLabel: 'long', decimals: 2 })).toBe(
      '1.50 trillion',
    );
  });

  it('adds custom units', () => {
    expect(f(36.81, { suffix: ' t CO₂', decimals: 1 })).toBe('36.8 t CO₂');
    expect(f(7, { prefix: '≈ ', suffix: ' years' })).toBe('≈ 7.00 years');
  });

  it('keeps a fixed number of decimals so animated counters do not jitter', () => {
    const texts = [12.0, 12.05, 12.5, 13].map((value) => f(value, { decimals: 1 }));
    expect(texts).toEqual(['12.0', '12.1', '12.5', '13.0']);
  });

  it('handles zero, negative zero, negatives and non-finite input', () => {
    expect(f(0, { scale: 'auto' })).toBe('0.00');
    expect(f(-0, { style: 'integer' })).toBe('0');
    expect(f(-2_500_000, { scale: 'auto' })).toBe('-2.50M');
    expect(f(Number.NaN)).toBe('—');
    expect(f(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
