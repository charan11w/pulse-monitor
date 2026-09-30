const assert = require('node:assert/strict');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { setTimeout: sleep } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { authenticateApiKey } = require('../dist/services/api-key.service.js');
const { runTraffic } = require('../dist/demo/traffic.js');
const children = [];
const db = new PrismaClient();
let stage = 'configuration';
const diagnostics = { acceptedBatches: 0, rejectedBatches: 0, completedBatches: 0, failedAttempts: 0, sdk: null, startupFailure: null };
function observe(line) {
  try {
    const entry = JSON.parse(line);
    if (entry.event === 'request_completed' && entry.path === '/batch') {
      diagnostics[entry.status === 202 ? 'acceptedBatches' : 'rejectedBatches']++;
    }
    if (entry.event === 'batch_persisted') diagnostics.completedBatches++;
    if (entry.event === 'batch_attempt_failed') diagnostics.failedAttempts++;
    if (entry.event === 'demo_stopped') {
      diagnostics.sdk = { captured: entry.captured, queued: entry.queued, dropped: entry.dropped,
        retryAttempts: entry.retryAttempts, pending: entry.pending };
    }
  } catch { /* Only report known, non-secret counters. */ }
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function start(file, env, readyEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    children.push(child);
    let ready = false;
    const timer = setTimeout(() => {
      diagnostics.startupFailure = 'deadline';
      reject(new Error('Child startup deadline exceeded'));
    }, 30000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', observe);
    lines.on('line', line => {
      try {
        if (JSON.parse(line).event === readyEvent) { ready = true; clearTimeout(timer); resolve(child); }
      } catch { /* Never print arbitrary child output or secrets. */ }
    });
    readline.createInterface({ input: child.stderr }).on('line', observe);
    child.once('error', error => {
      clearTimeout(timer); diagnostics.startupFailure = ['EACCES', 'EPERM', 'ENOENT'].includes(error.code) ? error.code : 'spawn';
      reject(new Error('Child startup failed'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (!ready) { diagnostics.startupFailure = 'exit-' + code; reject(new Error('Child exited during startup')); }
    });
  });
}
function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill(), 12000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send('shutdown'); else child.kill();
  });
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/pulsemonitor');
  const rawKey = process.env.DEMO_API_KEY || process.env.SEED_API_KEY;
  const identity = await authenticateApiKey(db, rawKey);
  const count = Number(process.env.DEMO_REQUESTS || 30);
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 300);
  const apiPort = await freePort(), demoPort = await freePort();
  const service = 'demo-' + randomUUID();
  stage = 'API startup'; await start('dist/server.js', { PORT: String(apiPort) }, 'server_started');
  stage = 'worker startup'; await start('dist/worker.js', {}, 'worker_ready');
  stage = 'demo startup';
  const demo = await start('dist/demo/server.js', { DEMO_PORT: String(demoPort), DEMO_API_KEY: rawKey,
    DEMO_SERVICE: service, DEMO_COLLECTOR_URL: `http://127.0.0.1:${apiPort}/api/v1/telemetry/batch` }, 'demo_started');
  stage = 'finite traffic'; const responses = await runTraffic(`http://127.0.0.1:${demoPort}`, count);
  stage = 'SDK shutdown flush'; await stop(demo);
  stage = 'database verification';
  const end = Date.now() + 15000;
  let stored = 0;
  while (Date.now() < end) {
    stored = await db.telemetryEvent.count({ where: { projectId: identity.projectId, service } });
    if (stored === count) break; await sleep(100);
  }
  assert.equal(stored, count);
  const rows = await db.telemetryEvent.findMany({ where: { projectId: identity.projectId, service } });
  assert.equal(rows.filter(row => row.statusCode === 500).length, responses.failing);
  assert.ok(rows.every(row => ['/items/:id', '/slow', '/fail'].includes(row.route)));
  console.log(JSON.stringify({ event: 'demo_verified', requests: count, stored, ...responses, service }));
  console.log('SDK -> HTTP API -> Redis/BullMQ -> independent worker -> PostgreSQL verified. Demo events remain available for later charts.');
}
main().catch(error => {
  console.error('Demo failed at: ' + stage + '. Check services, migrations/seed and the local demo key.');
  console.error(JSON.stringify({ ...diagnostics, failure: error.name }));
  process.exitCode = 1;
})
  .finally(async () => { for (const child of children.reverse()) await stop(child); await db.$disconnect(); });
