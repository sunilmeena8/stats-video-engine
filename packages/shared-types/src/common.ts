/** RFC 9562 UUID string. */
export type Uuid = string;

/** ISO-8601 date-time string in UTC, e.g. `2026-01-31T12:00:00.000Z`. */
export type IsoDateTime = string;

/**
 * POSIX-style path relative to the configured storage root (e.g. `datasets/gdp/v1.csv`).
 * Never absolute and never containing `..` segments, so records stay portable between machines.
 */
export type StorageRelativePath = string;

export interface Timestamps {
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Inclusive range of calendar years. Negative values represent BCE years. */
export interface YearRange {
  startYear: number;
  endYear: number;
}
