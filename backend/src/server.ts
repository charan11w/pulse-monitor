import { PORT, FRONTEND_ORIGIN } from './config/env.js';
import { attachLive } from './live.js';
import { localRedisOptions } from './telemetry/queue.js';
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
  void live.close();
});
const live = attachLive(server, database, FRONTEND_ORIGIN, localRedisOptions());

onShutdown(async () => {
  await live.close();
  await closeTelemetryQueue();
  await database.$disconnect();
});
