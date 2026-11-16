import type { IsoDateTime, Timestamps, Uuid } from './common.js';

/** `viewer`: read only. `editor`: datasets, projects, renders. `admin`: everything. */
export const USER_ROLES = ['admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User extends Timestamps {
  id: Uuid;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: IsoDateTime | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  /** Bearer token for the Authorization header. Opaque; stored only as a hash. */
  token: string;
  expiresAt: IsoDateTime;
  user: User;
}

export interface Topic extends Timestamps {
  id: Uuid;
  slug: string;
  name: string;
  description: string | null;
}

export interface CreateTopicRequest {
  name: string;
  slug?: string | undefined;
  description?: string | null | undefined;
}
