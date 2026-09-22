import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const requestIdMiddleware: RequestHandler = (req, res, next) => {
  // Generate our own ID instead of trusting arbitrary incoming headers.
  req.requestId = `req_${randomUUID()}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export default requestIdMiddleware;
