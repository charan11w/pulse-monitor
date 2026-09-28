import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { login, SESSION_DURATION_MS } from '../services/auth.service.js';
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.middleware.js';
import { browserSecurity } from '../middleware/browser-security.middleware.js';
import { loginLimit } from '../middleware/login-limit.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { AppError } from '../utils/app-error.js';

export function createAuthRoutes(db: PrismaClient, frontendOrigin: string, production = false) {
  const routes = Router();
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: production, path: '/' };
  routes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  routes.use(browserSecurity(frontendOrigin));
  routes.post('/login', loginLimit(), validateBody(z.object({
    email: z.string().trim().toLowerCase().max(254).email(),
    password: z.string().min(1).max(128),
  }).strict()), async (req, res) => {
    const result = await login(db, req.body.email, req.body.password);
    if (!result) throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    res.cookie(SESSION_COOKIE, result.token, { ...cookieOptions, maxAge: SESSION_DURATION_MS });
    res.json({ user: result.user });
  });
  routes.get('/me', requireAuth(db), (req, res) => res.json({ user: req.auth!.user }));
  routes.post('/logout', requireAuth(db), async (req, res) => {
    await db.session.deleteMany({ where: { tokenHash: req.auth!.tokenHash } });
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.sendStatus(204);
  });
  return routes;
}
