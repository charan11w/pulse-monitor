import { Worker, type Processor } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { RedisOptions } from 'ioredis';
import { QUEUE_NAME } from './queue.js';
import { createProcessor } from './processor.js';
import type { TelemetryJob } from './schema.js';

export function createTelemetryWorker(db: PrismaClient, connection: RedisOptions, name = QUEUE_NAME,
  processor: Processor<TelemetryJob> = createProcessor(db)) {
  const worker = new Worker<TelemetryJob>(name, processor, {
    connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 2,
    maxStalledCount: 1, lockDuration: 10000, stalledInterval: 5000,
  });
  worker.on('error', () => console.error(JSON.stringify({ event: 'worker_connection_error' })));
  worker.on('completed', job => console.info(JSON.stringify({
    event: 'batch_persisted', jobId: job.id, requestId: job.data.requestId, inserted: job.returnvalue?.inserted,
  })));
  worker.on('failed', (job, error) => console.error(JSON.stringify({
    event: 'batch_attempt_failed', jobId: job?.id, attempt: job?.attemptsMade,
    failure: error.name === 'UnrecoverableError' ? 'permanent' : 'retryable',
  })));
  return worker;
}
