import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import type { TelemetryJob } from './schema.js';
import { AppError } from '../utils/app-error.js';

export const QUEUE_NAME = 'telemetry';
export const QUEUE_DEFAULTS = { capacity: 100, perMinute: 60, retained: 100, backoffMs: 1000 };

export function localRedisOptions(): RedisOptions {
  const value = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid REDIS_URL'); }
  if (url.protocol !== 'redis:' || !['127.0.0.1', ...(process.env.CONTAINER_MODE === '1' ? ['redis'] : [])].includes(url.hostname) || url.username || url.password ||
      (url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('Invalid local REDIS_URL');
  return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1000 };
}

export function createTelemetryQueue(connectionOptions: RedisOptions, name = QUEUE_NAME,
  limits = QUEUE_DEFAULTS) {
  const connection = new Redis({ ...connectionOptions, maxRetriesPerRequest: 0,
    enableOfflineQueue: false, autoResendUnfulfilledCommands: false, commandTimeout: 2000 });
  connection.on('error', () => {}); // Request errors are translated to safe 503 responses.
  const queue = new Queue<TelemetryJob>(name, { connection, streams: { events: { maxLen: 1000 } },
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: limits.backoffMs },
      removeOnComplete: { count: limits.retained }, removeOnFail: { count: limits.retained } } });
  queue.on('error', () => {});
  let admitting = false;
  let uncertain = false;
  let closed = false;
  return {
    queue, connection,
    async enqueue(data: TelemetryJob) {
      // One API process is the supported topology. This gate serializes count+add,
      // rejecting concurrent admission immediately instead of growing an in-memory wait list.
      if (closed || uncertain || admitting || connection.status !== 'ready') {
        throw new AppError('Telemetry queue unavailable. Retry later.', 503, 'QUEUE_UNAVAILABLE');
      }
      admitting = true;
      let adding = false;
      try {
        // BullMQ reads these state counts in a single Redis Lua invocation.
        const counts = await queue.getJobCounts('wait', 'paused', 'active', 'delayed', 'prioritized', 'waiting-children');
        if (Object.values(counts).reduce((sum, value) => sum + value, 0) >= limits.capacity) {
          throw new AppError('Telemetry queue is full. Retry later.', 503, 'QUEUE_FULL');
        }
        const count = await connection.eval(`
          local count = redis.call('INCR', KEYS[1])
          if count == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
          return count`, 1, `${name}:rate:${data.projectId}`) as number;
        if (count > limits.perMinute) throw new AppError('Telemetry rate limit reached.', 429, 'RATE_LIMITED');
        const jobId = randomUUID();
        adding = true;
        await queue.add('persist-batch', data, { jobId });
        return jobId;
      } catch (error) {
        if (error instanceof AppError) throw error;
        // A lost enqueue acknowledgement may still mean a job was written. Stop
        // admissions until API restart, so a late write cannot evade the capacity check.
        if (adding) uncertain = true;
        throw new AppError('Telemetry queue unavailable. Retry later.', 503, 'QUEUE_UNAVAILABLE');
      } finally { admitting = false; }
    },
    async close() {
      closed = true;
      await queue.close();
      connection.disconnect();
    },
  };
}

let producer: ReturnType<typeof createTelemetryQueue> | undefined;
export function getTelemetryQueue() {
  return producer ??= createTelemetryQueue(localRedisOptions());
}
export async function closeTelemetryQueue() { await producer?.close(); }
