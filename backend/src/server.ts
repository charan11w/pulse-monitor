import { PORT } from './config/env.js';
import app from './app.js';
import { database } from './config/database.js';
import { closeTelemetryQueue, getTelemetryQueue } from './telemetry/queue.js';
import { onShutdown } from './utils/shutdown.js';

getTelemetryQueue();

const server = app.listen(PORT, () => {
  console.info(JSON.stringify({ event: 'server_started', port: PORT }));
});

server.on('error', () => {
  console.error(JSON.stringify({ event: 'server_start_failed', port: PORT }));
  process.exitCode = 1;
  void closeTelemetryQueue();
});

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await closeTelemetryQueue();
  await database.$disconnect();
});
