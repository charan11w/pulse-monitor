import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

export function browserSecurity(frontendOrigin: string): RequestHandler {
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    if (origin && origin !== frontendOrigin) {
      return next(new AppError('Origin not allowed.', 403, 'FORBIDDEN_ORIGIN'));
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PulseMonitor-Request');
      res.sendStatus(204);
      return;
    }
    // A cross-origin HTML form cannot supply this custom header. Browsers must preflight it.
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-PulseMonitor-Request') !== '1') {
      return next(new AppError('Required request header missing.', 403, 'CSRF_REJECTED'));
    }
    next();
  };
}
