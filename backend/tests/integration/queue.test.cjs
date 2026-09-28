const assert = require('node:assert/strict');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { Router } = require('express');
const { createApp } = require('../../dist/app.js');
const { createTelemetryRoutes } = require('../../dist/routes/telemetry.route.js');
const { createTelemetryQueue, localRedisOptions } = require('../../dist/telemetry/queue.js');
const { createTelemetryWorker } = require('../../dist/telemetry/worker.js');
const { createProcessor } = require('../../dist/telemetry/processor.js');
const schema = 'phase5_check_' + randomBytes(8).toString('hex');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/pulsemonitor');
const admin = new PrismaClient();
const projectId = randomUUID();
const apiKeyId = randomUUID();
const rawKey = 'pm_test_' + randomBytes(24).toString('hex');
const redisOptions = localRedisOptions();
const limits = { capacity: 4, perMinute: 100, retained: 2, backoffMs: 30 };
let db, created = false, producer, worker, server, base, queueName, logs;
const event = () => ({ eventId: randomUUID(), requestId: randomUUID(), service: 'test-api',
  environment: 'test', route: '/items/:id', method: 'GET', statusCode: 200, responseTime: 12,
  timestamp: new Date().toISOString() });
async function until(check, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  throw new Error('Condition did not become true before deadline');
}
async function send(body = { events: [event()] }, key = rawKey) {
  return fetch(base + '/api/v1/telemetry/batch', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) }, body: JSON.stringify(body) });
}
async function startWorker(processor) {
  worker = createTelemetryWorker(db, redisOptions, queueName, processor);
  await worker.waitUntilReady();
}
before(async () => {
  assert.match(schema, /^phase5_check_[a-f0-9]{16}$/);
  await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"'); created = true;
  url.searchParams.set('schema', schema);
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  assert.equal(result.status, 0, 'isolated migrations must succeed');
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const user = await db.user.create({ data: { name: 'Queue test', email: 'queue@example.test', passwordHash: 'unused' } });
  await db.project.create({ data: { id: projectId, userId: user.id, name: 'Queue test', environment: 'test' } });
  await db.apiKey.create({ data: { id: apiKeyId, projectId, name: 'Queue test', keyPrefix: rawKey.slice(0, 12),
    keyHash: createHash('sha256').update(rawKey).digest('hex') } });
});
beforeEach(async t => {
  await db.telemetryEvent.deleteMany();
  logs = [];
  t.mock.method(console, 'info', value => logs.push(value));
  t.mock.method(console, 'error', value => logs.push(value));
  queueName = 'phase5-' + randomUUID();
  producer = createTelemetryQueue(redisOptions, queueName, limits);
  await producer.queue.waitUntilReady();
  const routes = Router();
  routes.use('/api/v1/telemetry', createTelemetryRoutes(db, data => producer.enqueue(data)));
  server = createApp(routes).listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await worker?.close(); worker = undefined;
  // Clean only this generated queue, never the real telemetry queue.
  if (producer.connection.status !== 'ready') {
    await producer.close(); producer = createTelemetryQueue(redisOptions, queueName, limits);
    await producer.queue.waitUntilReady();
  }
  await producer.queue.obliterate({ force: true });
  await producer.connection.del(`${queueName}:rate:${projectId}`);
  await producer.close();
});
after(async () => {
  await db?.$disconnect();
  try { if (created) await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); }
  finally { await admin.$disconnect(); }
});

test('202 means queued; starting and restarting the worker persists waiting batches', async () => {
  const response = await send(); assert.equal(response.status, 202);
  const body = await response.json(); assert.equal(body.status, 'queued'); assert.equal(body.accepted, 1);
  assert.equal(await db.telemetryEvent.count(), 0);
  assert.equal(await producer.queue.getWaitingCount(), 1);
  const job = await producer.queue.getJob(body.jobId);
  assert.equal(job.data.projectId, projectId);
  assert.ok(!JSON.stringify(job.data).includes(rawKey));
  await startWorker(); await until(async () => await db.telemetryEvent.count() === 1);
  await worker.close(); worker = undefined;
  assert.equal((await send()).status, 202);
  await delay(80); assert.equal(await db.telemetryEvent.count(), 1);
  await startWorker(); await until(async () => await db.telemetryEvent.count() === 2);
  assert.ok(!logs.join('\n').includes(rawKey));
});

test('invalid, oversized, unauthenticated and forged-project batches never enqueue', async () => {
  for (const body of [{ events: [] }, { events: Array.from({ length: 51 }, event) }, { events: [event()], projectId: randomUUID() },
    { events: [{ ...event(), responseTime: -1 }] }, { events: [{ ...event(), statusCode: 700 }] },
    { events: [{ ...event(), timestamp: 'bad' }] }, { events: [{ ...event(), timestamp: new Date(0).toISOString() }] },
    { events: [{ ...event(), timestamp: new Date(Date.now() + 600000).toISOString() }] },
    { events: [{ ...event(), route: '/users?secret=private' }] }, { events: [{ ...event(), authorization: 'private' }] }]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal((await send({ events: [event()] }, null)).status, 401);
  assert.equal((await send({ events: [event()] }, 'bad-key')).status, 401);
  const oversized = await send({ padding: 'x'.repeat(110000) }); assert.equal(oversized.status, 413);
  assert.equal(await producer.queue.getWaitingCount(), 0);
});

test('replaying IDs within and across batches never duplicates database rows', async () => {
  await startWorker(); const sample = event();
  assert.equal((await send({ events: [sample, sample] })).status, 202);
  await until(async () => await producer.queue.getCompletedCount() === 1);
  assert.equal((await send({ events: [sample] })).status, 202);
  await until(async () => await producer.queue.getCompletedCount() === 2);
  assert.equal(await db.telemetryEvent.count(), 1);
});

test('a failure after a successful commit retries safely without inserting twice', async () => {
  const persist = createProcessor(db); let attempts = 0;
  await startWorker(async job => { const result = await persist(job); if (++attempts === 1) throw new Error('SIMULATED_LOST_ACK'); return result; });
  assert.equal((await send()).status, 202);
  await until(async () => await producer.queue.getCompletedCount() === 1);
  assert.equal(attempts, 2); assert.equal(await db.telemetryEvent.count(), 1);
});

test('real database connection failure is sanitized and recovers on a bounded retry', async () => {
  const downUrl = new URL(url); downUrl.port = '1'; downUrl.searchParams.set('connect_timeout', '1');
  const unavailable = new PrismaClient({ datasources: { db: { url: downUrl.toString() } } });
  const failing = createProcessor(unavailable), working = createProcessor(db); let attempts = 0;
  try {
    await startWorker(job => ++attempts === 1 ? failing(job) : working(job));
    assert.equal((await send()).status, 202);
    await until(async () => await producer.queue.getCompletedCount() === 1);
    assert.equal(attempts, 2); assert.equal(await db.telemetryEvent.count(), 1);
    assert.ok(!logs.join('\n').includes('postgresql://'));
  } finally { await unavailable.$disconnect(); }
});

test('permanent jobs fail once; transient failures stop at three attempts; retention is bounded', async () => {
  await startWorker();
  await producer.enqueue({ projectId: randomUUID(), requestId: 'test', events: [event()] });
  await until(async () => await producer.queue.getFailedCount() === 1);
  const [permanent] = await producer.queue.getFailed();
  assert.equal(permanent.attemptsMade, 1); assert.equal(permanent.failedReason, 'PERMANENT_DATABASE_ERROR');
  await worker.close(); worker = undefined;
  let attempts = 0;
  await startWorker(async () => { attempts++; throw new Error('TRANSIENT_DATABASE_ERROR'); });
  for (let i = 0; i < 3; i++) {
    const response = await send(); assert.equal(response.status, 202); const { jobId } = await response.json();
    await until(async () => (await producer.queue.getJob(jobId))?.getState().then(state => state === 'failed'));
  }
  assert.equal(attempts, 9); assert.equal(await producer.queue.getFailedCount(), 2);
  await worker.close(); worker = undefined; await startWorker();
  for (let i = 0; i < 4; i++) {
    const response = await send(); const { jobId } = await response.json();
    await until(async () => (await producer.queue.getJob(jobId))?.getState().then(state => state === 'completed'));
  }
  assert.equal(await producer.queue.getCompletedCount(), 2);
});

test('concurrent admission cannot exceed capacity; paused and active work also count', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => send()));
  assert.ok(responses.every(response => [202, 503].includes(response.status)));
  assert.ok(await producer.queue.getWaitingCount() <= limits.capacity);
  while (await producer.queue.getWaitingCount() < limits.capacity) assert.equal((await send()).status, 202);
  assert.equal((await send()).status, 503);
  await producer.queue.pause();
  assert.equal((await send()).status, 503);
  await producer.queue.resume();
  let release; const blocked = new Promise(resolve => { release = resolve; });
  await startWorker(async () => { await blocked; return { inserted: 0 }; });
  try {
    await until(async () => await producer.queue.getActiveCount() === 2);
    assert.equal((await send()).status, 503);
  } finally { release(); }
});

test('per-project ingestion rate limit returns 429 and Retry-After', async () => {
  await producer.close(); producer = createTelemetryQueue(redisOptions, queueName, { ...limits, perMinute: 2 });
  await producer.queue.waitUntilReady();
  assert.equal((await send()).status, 202); assert.equal((await send()).status, 202);
  const response = await send(); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(await producer.queue.getWaitingCount(), 2);
});

test('lost Redis connection fails promptly without false acceptance and reconnect can recover', async () => {
  producer.connection.disconnect();
  const start = Date.now(); const response = await send();
  assert.equal(response.status, 503); assert.ok(Date.now() - start < 3000);
  assert.equal((await response.json()).error.code, 'QUEUE_UNAVAILABLE');
  await producer.close(); producer = createTelemetryQueue(redisOptions, queueName, limits);
  await producer.queue.waitUntilReady(); assert.equal((await send()).status, 202);
});

test('uncertain enqueue acknowledgement closes admission until producer restart', async t => {
  const add = producer.queue.add.bind(producer.queue);
  t.mock.method(producer.queue, 'add', async (...args) => { await add(...args); throw new Error('Lost Redis acknowledgement'); });
  assert.equal((await send()).status, 503);
  assert.equal(await producer.queue.getWaitingCount(), 1);
  assert.equal((await send()).status, 503);
  assert.equal(await producer.queue.getWaitingCount(), 1);
});
