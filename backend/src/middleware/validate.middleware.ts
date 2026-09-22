import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/app-error.js';

export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Do not echo submitted values or schema error objects.
      return next(new AppError('Request validation failed', 400, 'VALIDATION_ERROR'));
    }
    req.body = result.data;
    next();
  };
}
