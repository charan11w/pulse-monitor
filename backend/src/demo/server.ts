import '../config/env.js';
import { createTelemetrySDK } from '../sdk/index.js';
import { createDemoApp } from './app.js';
import { onShutdown } from '../utils/shutdown.js';

const port = Number(process.env.DEMO_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DEMO_PORT');
const sdk = createTelemetrySDK({
  endpoint: process.env.DEMO_COLLECTOR_URL ?? 'http://127.0.0.1:3000/api/v1/telemetry/batch',
  apiKey: process.env.DEMO_API_KEY ?? process.env.SEED_API_KEY ?? '',
  service: process.env.DEMO_SERVICE ?? 'demo-api', environment: 'development',
});
const server = createDemoApp(sdk).listen(port, '127.0.0.1', () => {
  console.info(JSON.stringify({ event: 'demo_started', port }));
});
server.on('error', () => {
  console.error(JSON.stringify({ event: 'demo_start_failed' }));
  process.exitCode = 1; void sdk.shutdown(0);
});
onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await sdk.shutdown();
  console.info(JSON.stringify({ event: 'demo_stopped', ...sdk.stats() }));
});
