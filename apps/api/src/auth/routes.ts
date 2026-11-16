import { loginRequestSchema } from '@statsopedia/shared-schemas';
import { Router } from 'express';

import { clientIp, rateLimit } from '../http/rate-limit.js';
import { authenticate, bearerToken, currentUser } from './middleware.js';
import type { AuthService } from './service.js';

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  // Brute-force protection: per IP and per account.
  const perIp = rateLimit({ name: 'login-ip', windowMs: 15 * 60_000, max: 50, key: clientIp });
  const perAccount = rateLimit({
    name: 'login-account',
    windowMs: 15 * 60_000,
    max: 10,
    key: (req) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === 'string' ? email.toLowerCase() : clientIp(req);
    },
  });

  router.post('/login', perIp, perAccount, async (req, res) => {
    const { email, password } = loginRequestSchema.parse(req.body);
    res.json(await auth.login(email, password));
  });

  router.get('/me', authenticate(auth), (_req, res) => {
    res.json({ user: currentUser(res) });
  });

  router.post('/logout', authenticate(auth), async (req, res) => {
    await auth.logout(bearerToken(req)!);
    res.status(204).end();
  });

  return router;
}
