import type { ValueFormat } from '@statsopedia/shared-types';

interface ScaleStep {
  divisor: number;
  short: string;
  long: string;
}

const SCALE_STEPS: Record<'trillions' | 'billions' | 'millions' | 'thousands', ScaleStep> = {
  trillions: { divisor: 1e12, short: 'T', long: ' trillion' },
  billions: { divisor: 1e9, short: 'B', long: ' billion' },
  millions: { divisor: 1e6, short: 'M', long: ' million' },
  thousands: { divisor: 1e3, short: 'K', long: ' thousand' },
};

const AUTO_ORDER = [
  SCALE_STEPS.trillions,
  SCALE_STEPS.billions,
  SCALE_STEPS.millions,
  SCALE_STEPS.thousands,
] as const;

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    formatters.set(key, cached);
  }
  return cached;
}

function scaleFor(magnitude: number, format: ValueFormat): ScaleStep | null {
  if (format.scale === 'none') return null;
  if (format.scale === 'auto') return AUTO_ORDER.find((step) => magnitude >= step.divisor) ?? null;
  return SCALE_STEPS[format.scale];
}

/**
 * Fraction digits by magnitude, about three significant digits: 1,234 · 12.3 · 1.23 · $897B ·
 * $2.53T. Percentages below 10 keep one decimal (4.5%).
 */
function autoDecimals(
  scaledMagnitude: number,
  scaled: boolean,
  style: ValueFormat['style'],
): number {
  if (style === 'integer' && !scaled) return 0;
  if (scaledMagnitude >= 100) return 0;
  if (scaledMagnitude >= 10) return 1;
  return style === 'percent' ? 1 : 2;
}

/**
 * Formats a value for display, e.g. 1_234_000_000 USD → "$1.2B", 0.253 → "25.3%".
 * Non-finite input returns "—". Scale labels (K/M/B/T or " million"…) are English and go right
 * after the digits, so they sit correctly whichever side the locale puts the currency symbol.
 */
export function formatValue(value: number, format: ValueFormat): string {
  if (!Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;

  if (format.style === 'percent') {
    const points = format.percentInput === 'fraction' ? normalized * 100 : normalized;
    const decimals = format.decimals ?? autoDecimals(Math.abs(points), false, 'percent');
    const text = formatter(format.locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(points / 100);
    return `${format.prefix}${text}${format.suffix}`;
  }

  const step = scaleFor(Math.abs(normalized), format);
  const scaledValue = step ? normalized / step.divisor : normalized;
  const decimals =
    format.decimals ?? autoDecimals(Math.abs(scaledValue), step !== null, format.style);
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  if (format.style === 'currency' && format.currency) {
    options.style = 'currency';
    options.currency = format.currency;
  }

  const parts = formatter(format.locale, options).formatToParts(scaledValue);
  let text: string;
  if (step) {
    const label = format.scaleLabel === 'long' ? step.long : step.short;
    const lastDigit = parts.findLastIndex((part) =>
      ['integer', 'fraction', 'decimal', 'group'].includes(part.type),
    );
    text = parts
      .map((part, index) => (index === lastDigit ? part.value + label : part.value))
      .join('');
  } else {
    text = parts.map((part) => part.value).join('');
  }
  return `${format.prefix}${text}${format.suffix}`;
}
