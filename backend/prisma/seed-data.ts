import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { hash } from 'argon2';

export const demoIds = {
  user: '10000000-0000-4000-8000-000000000001',
  project: '10000000-0000-4000-8000-000000000002',
  key: '10000000-0000-4000-8000-000000000003',
};
export const demoEmail = 'demo@pulsemonitor.local';

export async function makeSeedHashes(password: string, apiKey: string) {
  if (password.length < 24 || apiKey.length < 24) {
    throw new Error('Local seed secrets must contain at least 24 characters.');
  }
  return {
    passwordHash: await hash(password),
    keyHash: createHash('sha256').update(apiKey).digest('hex'),
    keyPrefix: apiKey.slice(0, 12),
  };
}

// Caller owns the transaction, so the whole seed succeeds or rolls back.
export async function seedDemo(
  db: Prisma.TransactionClient,
  hashes: Awaited<ReturnType<typeof makeSeedHashes>>,
) {
  const user = await db.user.upsert({
    where: { id: demoIds.user },
    update: {}, // Never reset an existing password or user edits.
    create: {
      id: demoIds.user, name: 'Demo owner', email: demoEmail,
      passwordHash: hashes.passwordHash,
    },
  });
  if (user.email !== demoEmail) throw new Error('Reserved demo user ID is already in use.');

  const project = await db.project.upsert({
    where: { id: demoIds.project },
    update: {},
    create: {
      id: demoIds.project, userId: user.id, name: 'Demo API',
      description: 'Local SDK sample data', environment: 'development',
    },
  });
  if (project.userId !== user.id) throw new Error('Reserved demo project ID is already in use.');

  const key = await db.apiKey.upsert({
    where: { id: demoIds.key },
    update: {}, // Keep existing key material and revocation state.
    create: {
      id: demoIds.key, projectId: project.id, name: 'Local demo key',
      keyHash: hashes.keyHash, keyPrefix: hashes.keyPrefix,
    },
  });
  if (key.projectId !== project.id) throw new Error('Reserved demo key ID is already in use.');

  const timestamp = new Date();
  const samples = [
    { route: '/users', method: 'GET', statusCode: 200, responseTime: 120 },
    { route: '/users', method: 'GET', statusCode: 200, responseTime: 150 },
    { route: '/users', method: 'POST', statusCode: 201, responseTime: 210 },
    { route: '/projects', method: 'GET', statusCode: 200, responseTime: 95 },
    { route: '/projects', method: 'GET', statusCode: 500, responseTime: 430 },
  ];

  return db.telemetryEvent.createMany({
    data: samples.map((sample, index) => ({
      ...sample,
      projectId: project.id,
      eventId: 'seed-demo-' + (index + 1),
      requestId: 'seed-request-' + (index + 1),
      service: 'demo-api',
      environment: 'development',
      timestamp,
    })),
    skipDuplicates: true,
  });
}
