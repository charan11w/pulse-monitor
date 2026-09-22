import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Read-only fingerprint for the manual stop/start persistence check.
const prisma = new PrismaClient();
async function main() {
  const tables = await prisma.$transaction([
    prisma.user.findMany({ orderBy: { id: 'asc' } }),
    prisma.project.findMany({ orderBy: { id: 'asc' } }),
    prisma.apiKey.findMany({ orderBy: { id: 'asc' } }),
    prisma.telemetryEvent.findMany({ orderBy: { id: 'asc' } }),
    prisma.metricAggregate.findMany({ orderBy: { id: 'asc' } }),
  ], { isolationLevel: 'RepeatableRead' });
  console.log(JSON.stringify({
    counts: {
      users: tables[0].length, projects: tables[1].length,
      keys: tables[2].length, events: tables[3].length, aggregates: tables[4].length,
    },
    fingerprint: createHash('sha256').update(JSON.stringify(tables)).digest('hex'),
  }));
}
main().catch(() => {
  console.error('Could not read local database snapshot. Check db:start and db:migrate.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
