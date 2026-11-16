import { createHash } from 'node:crypto';

import type { User, UserRole } from '@statsopedia/shared-types';

import type { Queryable } from '../db/database.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  password_hash?: string;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function findUserByEmail(
  db: Queryable,
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  const { rows } = await db.query<UserRow & { password_hash: string }>(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}

export async function insertUser(
  db: Queryable,
  input: { id: string; email: string; name: string; role: UserRole; passwordHash: string },
): Promise<User> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.id, input.email.toLowerCase(), input.name, input.role, input.passwordHash],
  );
  return toUser(rows[0]!);
}

export async function createSession(
  db: Queryable,
  input: { id: string; userId: string; token: string; expiresAt: Date },
): Promise<void> {
  await db.query(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [input.id, input.userId, hashToken(input.token), input.expiresAt],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [input.userId]);
}

/** The active user behind a token, or null (unknown, expired, revoked or deactivated). */
export async function userForToken(db: Queryable, token: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `UPDATE sessions s SET last_used_at = now()
       FROM users u
      WHERE s.token_hash = $1 AND s.user_id = u.id
        AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active
     RETURNING u.*`,
    [hashToken(token)],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function revokeSession(db: Queryable, token: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [
    hashToken(token),
  ]);
}

export async function deleteExpiredSessions(db: Queryable): Promise<number> {
  const result = await db.query(
    "DELETE FROM sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day'",
  );
  return result.rowCount ?? 0;
}
