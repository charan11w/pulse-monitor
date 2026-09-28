import './config/env.js';
import { database } from './config/database.js';
import { localRedisOptions } from './telemetry/queue.js';
import { createTelemetryWorker } from './telemetry/worker.js';
import { onShutdown } from './utils/shutdown.js';

const worker = createTelemetryWorker(database, localRedisOptions());
worker.on('ready', () => console.info(JSON.stringify({ event: 'worker_ready', concurrency: 2 })));
onShutdown(async () => { await worker.close(); await database.$disconnect(); });
