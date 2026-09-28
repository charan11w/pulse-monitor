import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { browserSecurity } from '../middleware/browser-security.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { getOwnedProject, projectFields } from '../services/project.service.js';
import { createProjectKey, keyFields, revokeProjectKey } from '../services/api-key.service.js';
import { AppError } from '../utils/app-error.js';

const nameSchema = z.string().trim().min(1).max(80);
const projectBody = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
  environment: z.enum(['development', 'test', 'staging', 'production']).default('development'),
}).strict();
const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).default('1').transform(Number).pipe(z.number().int().min(1).max(1000)),
  pageSize: z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(50)),
}).strict();
function pagination(query: unknown) {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) throw new AppError('Invalid pagination.', 400, 'VALIDATION_ERROR');
  return parsed.data;
}

export function createProjectRoutes(db: PrismaClient, frontendOrigin: string) {
  const routes = Router();
  routes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  routes.use(browserSecurity(frontendOrigin));
  routes.use(requireAuth(db));

  routes.post('/', validateBody(projectBody), async (req, res) => {
    const project = await db.project.create({
      data: { ...req.body, userId: req.auth!.user.id }, select: projectFields,
    });
    res.status(201).json({ project });
  });
  routes.get('/', async (req, res) => {
    const { page, pageSize } = pagination(req.query);
    const projects = await db.project.findMany({
      where: { userId: req.auth!.user.id }, select: projectFields,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize + 1,
    });
    res.json({ projects: projects.slice(0, pageSize), page, pageSize, hasMore: projects.length > pageSize });
  });
  routes.get('/:projectId', async (req, res) => {
    res.json({ project: await getOwnedProject(db, req.auth!.user.id, req.params.projectId) });
  });
  routes.post('/:projectId/keys', validateBody(z.object({ name: nameSchema }).strict()), async (req, res) => {
    res.status(201).json(await createProjectKey(db, req.auth!.user.id, req.params.projectId, req.body.name));
  });
  routes.get('/:projectId/keys', async (req, res) => {
    const project = await getOwnedProject(db, req.auth!.user.id, req.params.projectId);
    const { page, pageSize } = pagination(req.query);
    const apiKeys = await db.apiKey.findMany({
      where: { projectId: project.id }, select: keyFields,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize + 1,
    });
    res.json({ apiKeys: apiKeys.slice(0, pageSize), page, pageSize, hasMore: apiKeys.length > pageSize });
  });
  routes.post('/:projectId/keys/:keyId/revoke', async (req, res) => {
    await revokeProjectKey(db, req.auth!.user.id, req.params.projectId, req.params.keyId);
    res.sendStatus(204);
  });
  return routes;
}
