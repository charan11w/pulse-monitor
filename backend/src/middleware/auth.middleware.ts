import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/app-error.js';
import { hashSessionToken, publicUserFields } from '../services/auth.service.js';

export const SESSION_COOKIE = 'pm_session';

export function requireAuth(db: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
      .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
    const token = cookies.length === 1 ? cookies[0]!.slice(SESSION_COOKIE.length + 1) : '';
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new AppError('Authentication required.', 401, 'UNAUTHENTICATED');
    }
    const tokenHash = hashSessionToken(token);
    const session = await db.session.findUnique({
      where: { tokenHash }, include: { user: { select: publicUserFields } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Authentication required.', 401, 'UNAUTHENTICATED');
    }
    req.auth = { user: session.user, tokenHash };
    next();
  };
}
