import express from 'express';
import { setTimeout as sleep } from 'node:timers/promises';
import type { createTelemetrySDK } from '../sdk/index.js';

export function createDemoApp(sdk: ReturnType<typeof createTelemetrySDK>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(sdk.middleware);
  app.get('/items/:id', (req, res) => res.json({ id: req.params.id, name: 'Demo item' }));
  app.get('/slow', async (_req, res) => { await sleep(80); res.json({ ok: true }); });
  app.get('/fail', (_req, res) => res.status(500).json({ error: 'Demonstration failure' }));
  return app;
}
