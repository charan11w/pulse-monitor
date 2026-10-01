// Verify the installed archive with a local collector; no keys or Docker required.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { createTelemetrySDK } = require('@pulsemonitor/express-sdk');
(async () => {
  const collector = express();
  collector.use(express.json());
  const events = [];
  // Delivery is at least once; model the real collector's event-ID deduplication.
  collector.post('/batch', (req, res) => {
    for (const event of req.body.events) if (!events.some(saved => saved.eventId === event.eventId)) events.push(event);
    res.sendStatus(202);
  });
  const receiver = collector.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const sdk = createTelemetrySDK({ endpoint: `http://127.0.0.1:${receiver.address().port}/batch`, apiKey: 'x'.repeat(32), service: 'installed-package-check', timeoutMs: 5000 });
  const app = express();
  app.use(sdk.middleware);
  app.get('/items/:id', (_req, res) => res.json({ ok: true }));
  app.get('/fail', (_req, res) => res.sendStatus(500));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const route of ['/items/123?secret=not-collected', '/fail']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
      await response.arrayBuffer();
    }
    await sdk.flush();
    assert.equal(events.length, 2);
    assert.equal(events[0].route, '/items/:id');
    assert.equal(events[1].statusCode, 500);
    assert.equal(JSON.stringify(events).includes('not-collected'), false);
    assert.equal(sdk.stats().queued, 2);
    console.log('Installed SDK verified: 2 requests captured; normalized route, 500 status and query privacy checked.');
  } finally {
    await sdk.shutdown();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => receiver.close(resolve))]);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
