import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

export function loginLimit(): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const windowMs = 15 * 60 * 1000;
  return (req, res, next) => {
    const now = Date.now();
    for (const [ip, entry] of attempts) if (entry.resetAt <= now) attempts.delete(ip);
    const ip = req.ip ?? 'unknown';
    let entry = attempts.get(ip);
    if (!entry && attempts.size < 1000) {
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(ip, entry);
    }
    if (!entry || entry.count >= 10) {
      res.setHeader('Retry-After', Math.ceil(((entry?.resetAt ?? now + windowMs) - now) / 1000));
      return next(new AppError('Too many login attempts. Try again later.', 429, 'RATE_LIMITED'));
    }
    entry.count++;
    next();
  };
}
