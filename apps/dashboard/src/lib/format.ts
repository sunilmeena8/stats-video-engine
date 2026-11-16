import type { DatasetVersionStatus, ValidationStatus } from '@statsopedia/shared-types';

import type { Tone } from './status';

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatValue(value: number | null): string {
  return value === null ? '—' : numberFormat.format(value);
}

export function formatCompact(value: number | null): string {
  return value === null ? '—' : compactFormat.format(value);
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-US');
}

export function formatTimestamp(iso: string | null): string {
  return iso === null ? '—' : dateTimeFormat.format(new Date(iso));
}

export function formatDate(iso: string | null): string {
  return iso === null ? '—' : dateFormat.format(new Date(iso));
}

/** "3 minutes ago", "yesterday". */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (iso === null) return '—';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return Math.abs(seconds) < 10 ? 'just now' : relativeFormat.format(seconds, 'second');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "0:24", "12:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const VERSION_STATUS: Record<DatasetVersionStatus, { tone: Tone; label: string }> = {
  uploaded: { tone: 'neutral', label: 'Uploaded' },
  processing: { tone: 'info', label: 'Processing' },
  ready: { tone: 'good', label: 'Ready' },
  failed: { tone: 'critical', label: 'Failed' },
};

export const VALIDATION_STATUS: Record<ValidationStatus, { tone: Tone; label: string }> = {
  pending: { tone: 'neutral', label: 'Not validated' },
  valid: { tone: 'good', label: 'Valid' },
  valid_with_warnings: { tone: 'warning', label: 'Valid with warnings' },
  invalid: { tone: 'critical', label: 'Invalid' },
};

/** "1", "2", "2=", "4": a trailing "=" marks a shared (tied) rank. */
export function formatRank(rank: number, tied: boolean): string {
  return tied ? `${rank}=` : String(rank);
}

/** Random key for the Idempotency-Key header (one per user action, reused on retry). */
export function newIdempotencyKey(): string {
  return `dash-${crypto.randomUUID()}`;
}
