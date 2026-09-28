import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getOwnedProject, parseId } from './project.service.js';
import { AppError } from '../utils/app-error.js';

export const keyFields = {
  id: true, name: true, keyPrefix: true, createdAt: true, revokedAt: true,
} as const;
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createProjectKey(db: PrismaClient, userId: string, projectId: unknown, name: string) {
  const project = await getOwnedProject(db, userId, projectId);
  const rawKey = 'pm_key_' + randomBytes(32).toString('hex');
  const apiKey = await db.apiKey.create({
    data: { projectId: project.id, name, keyHash: hashApiKey(rawKey), keyPrefix: rawKey.slice(0, 12) },
    select: keyFields,
  });
  // The only operation returning the raw credential. Never log this result.
  return { apiKey, rawKey };
}

export async function revokeProjectKey(db: PrismaClient, userId: string, projectId: unknown, keyId: unknown) {
  const project = await getOwnedProject(db, userId, projectId);
  const where = { id: parseId(keyId), projectId: project.id };
  const key = await db.apiKey.findFirst({ where, select: { id: true } });
  if (!key) throw new AppError('API key not found.', 404, 'API_KEY_NOT_FOUND');
  // Repeating revocation succeeds without changing its original timestamp.
  await db.apiKey.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function authenticateApiKey(db: PrismaClient, rawKey: unknown) {
  // Accept the existing locally generated seed key as well as newly issued keys.
  if (typeof rawKey !== 'string' || !/^[a-zA-Z0-9_-]{24,128}$/.test(rawKey)) {
    throw new AppError('Invalid API key.', 401, 'INVALID_API_KEY');
  }
  const key = await db.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    select: { id: true, projectId: true, revokedAt: true },
  });
  if (!key || key.revokedAt) throw new AppError('Invalid API key.', 401, 'INVALID_API_KEY');
  return { projectId: key.projectId, apiKeyId: key.id };
}
