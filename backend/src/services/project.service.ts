import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../utils/app-error.js';

export const projectFields = {
  id: true, name: true, description: true, environment: true, createdAt: true, updatedAt: true,
} as const;

export function parseId(value: unknown): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new AppError('Invalid resource ID.', 400, 'VALIDATION_ERROR');
  return parsed.data;
}

export async function getOwnedProject(db: PrismaClient, userId: string, projectId: unknown) {
  const project = await db.project.findFirst({
    where: { id: parseId(projectId), userId }, select: projectFields,
  });
  // Unknown and unowned resources have the same response; IDs alone confer no access.
  if (!project) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  return project;
}
