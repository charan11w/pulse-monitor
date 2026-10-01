const express = require('express');
const { createTelemetrySDK } = require('@pulsemonitor/express-sdk');
const app = express();
const sdk = createTelemetrySDK({
  endpoint: process.env.PULSEMONITOR_URL || 'http://127.0.0.1:3000/api/v1/telemetry/batch',
  apiKey: process.env.PULSEMONITOR_API_KEY || '',
  service: 'another-express-app',
  environment: 'development',
  timeoutMs: 5000,
});
// Register before the routes you want to measure.
app.use(sdk.middleware);
app.get('/items/:id', (_req, res) => res.json({ ok: true }));
app.get('/slow', async (_req, res) => { await new Promise(resolve => setTimeout(resolve, 150)); res.json({ ok: true }); });
app.get('/fail', (_req, res) => res.status(500).json({ error: 'Intentional demo error' }));
const server = app.listen(4100, '127.0.0.1', () => console.log('External app: http://127.0.0.1:4100'));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  await new Promise(resolve => server.close(resolve));
  await sdk.shutdown(7000);
  clearTimeout(deadline);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
