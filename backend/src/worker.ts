import './config/env.js';
import { database } from './config/database.js';
import { localRedisOptions } from './telemetry/queue.js';
import { createTelemetryWorker } from './telemetry/worker.js';
import { onShutdown } from './utils/shutdown.js';
import { Redis } from 'ioredis';
import { createProcessor } from './telemetry/processor.js';
import { METRICS_CHANNEL } from './live.js';

const publisher = new Redis({ ...localRedisOptions(), maxRetriesPerRequest: 0, enableOfflineQueue: false, commandTimeout: 1000 });
publisher.on('error', () => {});
const worker = createTelemetryWorker(database, localRedisOptions(), undefined,
  createProcessor(database, projectId => publisher.publish(METRICS_CHANNEL, projectId)));
worker.on('ready', () => console.info(JSON.stringify({ event: 'worker_ready', concurrency: 2 })));
onShutdown(async () => { await worker.close(); publisher.disconnect(); await database.$disconnect(); });
