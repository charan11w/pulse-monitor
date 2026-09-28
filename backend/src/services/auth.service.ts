import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
export const publicUserFields = { id: true, name: true, email: true } as const;
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Unknown accounts still perform password verification; never return whether an email exists.
let dummyHash: Promise<string> | undefined;

export async function login(db: PrismaClient, email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  const passwordHash = user?.passwordHash ?? await (dummyHash ??= argon2.hash(randomBytes(32)));
  const valid = await argon2.verify(passwordHash, password);
  if (!user || !valid) return null;

  const token = randomBytes(32).toString('hex');
  const session = {
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    createdAt: new Date(),
  };
  // A new login replaces the previous session; storage stays bounded to one row per user.
  await db.session.upsert({
    where: { userId: user.id },
    create: { ...session, userId: user.id },
    update: session,
  });
  return { token, user: { id: user.id, name: user.name, email: user.email } };
}
