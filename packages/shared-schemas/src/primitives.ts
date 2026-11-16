import type { YearRange } from '@statsopedia/shared-types';
import { z } from 'zod';

/** Earliest and latest year accepted anywhere in the platform (negative = BCE). */
export const YEAR_MIN = -10_000;
export const YEAR_MAX = 2_500;

export const uuidSchema = z.uuid();

/** ISO-8601 date-time. Offsets are accepted because non-JS services (Python) emit `+00:00`. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase kebab-case (a-z, 0-9, "-")');

export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a #RRGGBB color');

export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Must be a lowercase hex SHA-256 digest');

export const yearSchema = z.int().min(YEAR_MIN).max(YEAR_MAX);

export const httpUrlSchema = z.url({ protocol: /^https?$/ });

/** True when `path` stays inside whatever root it is later joined to. */
export function isSafeRelativePath(path: string): boolean {
  if (path.includes('\0')) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === '..');
}

export const storageRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRelativePath, 'Must be a relative path that stays inside the storage root');

export const timestampsShape = {
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

export const yearRangeSchema = z
  .object({ startYear: yearSchema, endYear: yearSchema })
  .refine((range) => range.endYear >= range.startYear, {
    message: 'endYear must be greater than or equal to startYear',
    path: ['endYear'],
  }) satisfies z.ZodType<YearRange>;
