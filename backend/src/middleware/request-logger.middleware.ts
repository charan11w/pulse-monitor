import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';

export const requestLoggerMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    console.info(JSON.stringify({
      event: 'request_completed',
      requestId: req.requestId,
      method: req.method,
      // Templates omit dynamic IDs; unknown URLs and queries are not logged.
      path: req.route?.path ?? '[unmatched]',
      status: res.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    }));
  });
  next();
};
