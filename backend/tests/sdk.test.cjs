const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { createTelemetrySDK } = require('../dist/sdk/index.js');
const { createDemoApp } = require('../dist/demo/app.js');
const key = 'pm_test_' + 'a'.repeat(48);
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (check()) return; await sleep(10); }
  throw new Error('SDK condition timed out');
}
async function setup(t, handler = (_batch, res) => { res.writeHead(202); res.end('{}'); }, options = {}) {
  const batches = [];
  const collector = http.createServer((req, res) => {
    void (async () => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const batch = JSON.parse(Buffer.concat(chunks).toString()); batches.push(batch);
      await handler(batch, res, batches.length);
    })().catch(() => res.destroy());
  }).listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const endpoint = 'http://127.0.0.1:' + collector.address().port + '/batch';
  const sdk = createTelemetrySDK({ endpoint, apiKey: key, service: 'sdk-test', environment: 'test',
    flushIntervalMs: 10000, batchSize: 50, bufferLimit: 20, timeoutMs: 100,
    backoffMs: 10, maxRetryDelayMs: 20, ...options });
  const app = createDemoApp(sdk).listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  t.after(async () => {
    await sdk.shutdown(100);
    await new Promise(resolve => app.close(resolve));
    if (collector.listening) {
      collector.closeAllConnections(); await new Promise(resolve => collector.close(resolve));
    }
  });
  return { sdk, batches, collector, base };
}

test('SDK captures normal, slow, failure and unmatched responses without sensitive request data', async t => {
  const { sdk, batches, base } = await setup(t);
  const started = Date.now();
  for (const path of ['/items/private-resource?secret=private-query', '/slow', '/fail', '/private-unmatched']) {
    await (await fetch(base + path, { headers: { Authorization: 'private-auth', 'X-Request-Id': 'private-header' } })).text();
  }
  await sdk.flush(); const events = batches.flatMap(batch => batch.events);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.route), ['/items/:id', '/slow', '/fail', '/unmatched']);
  assert.deepEqual(events.map(event => event.statusCode), [200, 200, 500, 404]);
  assert.ok(events[1].responseTime >= 60);
  assert.equal(new Set(events.map(event => event.eventId)).size, 4);
  for (const event of events) {
    assert.equal(event.method, 'GET'); assert.equal(event.service, 'sdk-test'); assert.equal(event.environment, 'test');
    assert.match(event.requestId, /^[a-f0-9-]{36}$/);
    assert.ok(Date.parse(event.timestamp) >= started && Date.parse(event.timestamp) <= Date.now());
  }
  const serialized = JSON.stringify(batches);
  for (const secret of ['private-resource', 'private-query', 'private-auth', 'private-header', 'private-unmatched', key]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.deepEqual(sdk.stats(), { captured: 4, queued: 4, dropped: 0, retryAttempts: 0, pending: 0 });
});

test('SDK retries 429 and 503 with identical event IDs, then accepts only 202', async t => {
  const { sdk, batches, base } = await setup(t, (_batch, res, attempt) => {
    res.writeHead(attempt === 1 ? 429 : attempt === 2 ? 503 : 202, { 'Retry-After': '60' }); res.end('{}');
  });
  assert.equal((await fetch(base + '/items/1')).status, 200);
  await sdk.flush();
  assert.equal(batches.length, 3); assert.deepEqual(batches[0], batches[1]); assert.deepEqual(batches[1], batches[2]);
  assert.equal(sdk.stats().queued, 1); assert.equal(sdk.stats().retryAttempts, 2);
});

test('SDK drops permanent validation/auth failures without retrying', async t => {
  const { sdk, batches, base } = await setup(t, (_batch, res) => { res.writeHead(401); res.end('{}'); });
  assert.equal((await fetch(base + '/fail')).status, 500);
  await sdk.flush(); assert.equal(batches.length, 1);
  assert.equal(sdk.stats().dropped, 1); assert.equal(sdk.stats().retryAttempts, 0);
});

test('unavailable collector does not change the monitored response and retries remain finite', async t => {
  const { sdk, collector, base } = await setup(t);
  await new Promise(resolve => collector.close(resolve));
  const response = await fetch(base + '/items/123');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { id: '123', name: 'Demo item' });
  await sdk.flush(); assert.equal(sdk.stats().retryAttempts, 2); assert.equal(sdk.stats().dropped, 1);
  assert.equal(sdk.stats().pending, 0);
});

test('collector timeouts do not delay business responses and eventually drop the batch', async t => {
  const { sdk, batches, base } = await setup(t, () => {}, { batchSize: 1, timeoutMs: 80 });
  const response = await fetch(base + '/items/1'); assert.equal(response.status, 200);
  await until(() => batches.length > 0);
  assert.equal(sdk.stats().queued, 0); // Collector has not acknowledged anything.
  await sdk.flush(); assert.equal(batches.length, 3);
  assert.equal(sdk.stats().dropped, 1); assert.equal(sdk.stats().pending, 0);
});

test('buffer cap includes in-flight events, drops newest overflow and keeps one sender', async t => {
  let release; const blocked = new Promise(resolve => { release = resolve; }); let active = 0, maxActive = 0;
  const { sdk, batches, base } = await setup(t, async (_batch, res) => {
    active++; maxActive = Math.max(active, maxActive); await blocked;
    res.writeHead(202); res.end('{}'); active--;
  }, { batchSize: 1, bufferLimit: 3, timeoutMs: 5000 });
  try {
    for (let i = 0; i < 6; i++) assert.equal((await fetch(base + '/items/' + i)).status, 200);
    await until(() => batches.length === 1);
    assert.equal(sdk.stats().pending, 3); assert.equal(sdk.stats().dropped, 3);
  } finally { release(); }
  await sdk.flush(); assert.equal(batches.length, 3); assert.equal(sdk.stats().queued, 3); assert.equal(maxActive, 1);
});

test('periodic flush sends a partial batch and all payloads respect batchSize', async t => {
  const { sdk, batches, base } = await setup(t, undefined, { batchSize: 2, flushIntervalMs: 30 });
  for (let i = 0; i < 5; i++) await fetch(base + '/items/' + i);
  await until(() => sdk.stats().queued === 5);
  assert.ok(batches.every(batch => batch.events.length <= 2));
  assert.equal(batches.flatMap(batch => batch.events).length, 5);
});

test('shutdown interrupts retry backoff, clears pending work and stops further capture', async t => {
  const { sdk, batches, base } = await setup(t, (_batch, res) => {
    res.writeHead(429, { 'Retry-After': '60' }); res.end('{}');
  }, { batchSize: 1, maxRetryDelayMs: 10000 });
  await fetch(base + '/items/1'); await until(() => batches.length === 1);
  const start = Date.now(); await sdk.shutdown(30);
  assert.ok(Date.now() - start < 2000); assert.equal(sdk.stats().pending, 0); assert.equal(sdk.stats().dropped, 1);
  await fetch(base + '/items/2'); await sleep(50);
  assert.equal(sdk.stats().captured, 1); assert.equal(batches.length, 1);
  await sdk.shutdown(30);
});

test('SDK rejects unsafe configuration without printing submitted secrets', () => {
  const base = { endpoint: 'http://localhost:3000/batch', apiKey: key, service: 'test' };
  for (const extra of [{ bufferLimit: 0 }, { batchSize: 51 }, { maxAttempts: 100 }, { service: 'private value' },
    { apiKey: 'private value' }, { endpoint: 'file:///private' }, { endpoint: 'http://user:private@localhost' }]) {
    assert.throws(() => createTelemetrySDK({ ...base, ...extra }), error => !error.message.includes('private'));
  }
});
