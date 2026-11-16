import type { IsoDateTime } from './common.js';

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const DEPENDENCY_STATUSES = ['up', 'down'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export interface DependencyCheckResult {
  status: DependencyStatus;
  latencyMs: number;
  error: string | null;
}

/** Response body of every service's health endpoints (TypeScript and Python alike). */
export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: IsoDateTime;
  /** Dependency checks keyed by dependency name. Empty for liveness probes. */
  checks: Record<string, DependencyCheckResult>;
}
