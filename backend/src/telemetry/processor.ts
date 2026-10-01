import type { PrismaClient } from '@prisma/client';
import { UnrecoverableError, type Job } from 'bullmq';
import { jobSchema, type TelemetryJob } from './schema.js';

export function createProcessor(db: PrismaClient, notify?: (projectId: string) => Promise<unknown>) {
  return async (job: Job<TelemetryJob>) => {
    const parsed = jobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('INVALID_JOB');
    const { projectId, events } = parsed.data;
    try {
      const result = await db.telemetryEvent.createMany({
        data: events.map(event => ({ ...event, projectId, timestamp: new Date(event.timestamp) })),
        skipDuplicates: true,
      });
      // Notification failure must never turn a committed write into a failed job.
      if (notify) { try { await notify(projectId); } catch { /* REST recovers missed updates. */ } }
      return { inserted: result.count, received: events.length };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (['P2000', 'P2003', 'P2006', 'P2007'].includes(String(code))) {
        throw new UnrecoverableError('PERMANENT_DATABASE_ERROR');
      }
      // Never retain Prisma's error text: it may include SQL, credentials or event data.
      throw new Error('TRANSIENT_DATABASE_ERROR');
    }
  };
}
