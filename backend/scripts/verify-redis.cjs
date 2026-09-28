const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createTelemetryQueue, localRedisOptions } = require('../dist/telemetry/queue.js');

// Explicit opt-in check: temporarily stops the local Redis service, preserving its volume.
const name = 'persistence-check-' + randomUUID();
const root = path.resolve(__dirname, '../..');
const compose = ['compose', '--env-file', path.join(root, '.env'), '-f', path.join(root, 'compose.yaml')];
let producer;
function docker(args) {
  const result = spawnSync('docker', [...compose, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.status !== 0) throw new Error('Local Redis lifecycle command failed.');
}
async function main() {
  producer = createTelemetryQueue(localRedisOptions(), name);
  await producer.queue.waitUntilReady();
  const aof = await producer.connection.config('GET', 'appendonly');
  const sync = await producer.connection.config('GET', 'appendfsync');
  const eviction = await producer.connection.config('GET', 'maxmemory-policy');
  assert.equal(aof[1], 'yes'); assert.equal(sync[1], 'everysec'); assert.equal(eviction[1], 'noeviction');
  const probe = randomUUID();
  const job = await producer.queue.add('persistence-probe', { probe });
  await producer.close(); producer = undefined;
  docker(['stop', 'redis']);
  try { docker(['up', '-d', '--wait', 'redis']); }
  catch (error) { docker(['start', 'redis']); throw error; }
  producer = createTelemetryQueue(localRedisOptions(), name);
  await producer.queue.waitUntilReady();
  const restored = await producer.queue.getJob(job.id);
  assert.equal(restored.data.probe, probe);
  assert.equal(await restored.getState(), 'waiting');
  console.log('PASS: Redis AOF everysec/noeviction configured; waiting job survives service stop/start.');
  console.log('This is a clean restart check, not proof of zero power-loss data loss.');
}
main().catch(() => { console.error('Redis persistence check failed.'); process.exitCode = 1; })
  .finally(async () => {
    if (producer) {
      try { await producer.queue.obliterate({ force: true }); }
      finally { await producer.close(); }
    }
  });
