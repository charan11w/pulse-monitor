import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireApiKey } from '../middleware/api-key.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { ingestionSchema, type TelemetryJob } from '../telemetry/schema.js';
import { AppError } from '../utils/app-error.js';

export function createTelemetryRoutes(db: PrismaClient, enqueue: (data: TelemetryJob) => Promise<string>) {
  const routes = Router();
  routes.post('/batch', requireApiKey(db), validateBody(ingestionSchema), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const jobId = await enqueue({ events: req.body.events, projectId: req.telemetrySource!.projectId,
        requestId: req.requestId });
      res.status(202).json({ status: 'queued', jobId, accepted: req.body.events.length, requestId: req.requestId });
    } catch (error) {
      if (error instanceof AppError && [429, 503].includes(error.statusCode)) {
        res.setHeader('Retry-After', error.statusCode === 429 ? '60' : '1');
      }
      next(error);
    }
  });
  return routes;
}
