import { randomBytes, randomUUID } from 'node:crypto';

import type { LoginResponse, User } from '@statsopedia/shared-types';
import type { Logger } from '@statsopedia/utils/node';
import type pg from 'pg';

import { HttpError } from '../errors.js';
import { DUMMY_HASH, verifyPassword } from './passwords.js';
import * as repo from './repository.js';

export class AuthService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly sessionTtlMs: number,
    private readonly logger: Logger,
  ) {}

  /** Same error and similar timing for unknown emails, wrong passwords and disabled accounts. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await repo.findUserByEmail(this.pool, email);
    const valid = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !valid || !user.isActive) {
      this.logger.warn(
        { email, reason: !user ? 'unknown' : !valid ? 'password' : 'inactive' },
        'Login failed',
      );
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    await repo.createSession(this.pool, { id: randomUUID(), userId: user.id, token, expiresAt });
    this.logger.info({ userId: user.id }, 'User logged in');
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return { token, expiresAt: expiresAt.toISOString(), user: publicUser };
  }

  authenticate(token: string): Promise<User | null> {
    return repo.userForToken(this.pool, token);
  }

  logout(token: string): Promise<void> {
    return repo.revokeSession(this.pool, token);
  }
}
