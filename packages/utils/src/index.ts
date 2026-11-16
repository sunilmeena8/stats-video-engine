// Isomorphic helpers: safe to import from Node services, Next.js and Remotion bundles.
// Node-only helpers live in `@statsopedia/utils/node`.

export { formatValue } from './format.js';

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min (${min}) is greater than max (${max})`);
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation between `from` and `to`; `t` is not clamped. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** Formats large numbers for on-screen labels, e.g. 1_234_567 → "1.2M". */
export function formatCompactNumber(
  value: number,
  options: { locale?: string; maximumFractionDigits?: number } = {},
): string {
  const locale = options.locale ?? 'en-US';
  const maximumFractionDigits = options.maximumFractionDigits ?? 1;
  const key = `${locale}|${maximumFractionDigits}`;
  let formatter = compactFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits });
    compactFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

/** Formats a duration in seconds as e.g. "2h 5m 3s". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`formatDuration: expected a non-negative number, got ${totalSeconds}`);
  }
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder}s`);
  return parts.join(' ');
}

/** Compile-time exhaustiveness check for discriminated unions. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/**
 * JSON with object keys sorted at every level, so equal values always serialize identically
 * (PostgreSQL `jsonb` and JSON files may order keys differently). Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}
