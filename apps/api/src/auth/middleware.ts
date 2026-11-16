import type { User, UserRole } from '@statsopedia/shared-types';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { HttpError } from '../errors.js';
import type { AuthService } from './service.js';

const RANK: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2 };

/** The authenticated user. Only valid after `authenticate`. */
export function currentUser(res: Response): User {
  const user = res.locals.user as User | undefined;
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  return user;
}

export function bearerToken(req: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.get('authorization') ?? '');
  return match?.[1] ?? null;
}

/** Requires a valid `Authorization: Bearer <token>` header. */
export function authenticate(auth: AuthService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    auth
      .authenticate(token)
      .then((user) => {
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
        res.locals.user = user;
        next();
      })
      .catch(next);
  };
}

/** Viewers may read; editors may change content; admins may do everything. */
export function requireRole(role: UserRole): RequestHandler {
  return (_req, res, next) => {
    const user = currentUser(res);
    if (RANK[user.role] < RANK[role]) {
      next(new HttpError(403, 'FORBIDDEN', `Requires the ${role} role`));
      return;
    }
    next();
  };
}

/** Reads (GET/HEAD) need any role; everything else needs `editor`. */
export const writesNeedEditor: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  requireRole('editor')(req, res, next);
};
