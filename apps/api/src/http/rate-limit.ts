import type { Request, RequestHandler } from 'express';

import { HttpError } from '../errors.js';

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Bucket key; requests with the same key share a limit. */
  key: (req: Request) => string;
  name: string;
  now?: () => number;
}

/**
 * Fixed-window, in-memory rate limiter. Per process: run one API instance, or move the counters
 * to Redis before scaling out. Responds 429 with Retry-After.
 */
export function rateLimit({
  windowMs,
  max,
  key,
  name,
  now = Date.now,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();
  return (req, res, next) => {
    const time = now();
    if (time - lastSweep > windowMs) {
      for (const [bucketKey, bucket] of buckets)
        if (bucket.resetAt <= time) buckets.delete(bucketKey);
      lastSweep = time;
    }
    const id = `${name}:${key(req)}`;
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= time) {
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(id, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - time) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(new HttpError(429, 'RATE_LIMITED', `Too many requests; retry in ${retryAfter}s`));
      return;
    }
    next();
  };
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
