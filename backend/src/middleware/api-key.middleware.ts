import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticateApiKey } from '../services/api-key.service.js';

// For the phase 5 sender endpoint only; dashboard routes continue to require a user session.
export function requireApiKey(db: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    req.telemetrySource = await authenticateApiKey(db, req.get('X-API-Key'));
    // Never infer ownership from a projectId supplied in the body or query.
    next();
  };
}
