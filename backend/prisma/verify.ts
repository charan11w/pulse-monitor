import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { verify } from 'argon2';
import { demoIds, makeSeedHashes, seedDemo } from './seed-data.js';

const baseUrl = new URL(process.env.DATABASE_URL || '');
if (baseUrl.hostname !== '127.0.0.1' || baseUrl.pathname !== '/pulsemonitor') {
  throw new Error('Database verification is restricted to the local PulseMonitor database.');
}
const schemaName = 'phase2_check_' + randomBytes(8).toString('hex');
const admin = new PrismaClient();
let checks: PrismaClient | undefined;
let schemaCreated = false;
let stage = 'connection';

async function main() {
  // Only this generated schema is created/dropped; public and existing data stay intact.
  assert.match(schemaName, /^phase2_check_[a-f0-9]{16}$/);
  await admin.$executeRawUnsafe('CREATE SCHEMA "' + schemaName + '"');
  schemaCreated = true;
  baseUrl.searchParams.set('schema', schemaName);
  stage = 'fresh migrations';
  const migrated = spawnSync(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy',
  ], {
    env: { ...process.env, DATABASE_URL: baseUrl.toString() },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  if (migrated.error || migrated.status !== 0) {
    throw new Error('Migration process failed.');
  }
  console.log('PASS: both migrations applied to a fresh isolated schema.');
  checks = new PrismaClient({ datasources: { db: { url: baseUrl.toString() } } });
  const db = checks;

  stage = 'repeatable seed';
  const password = 'test-password-' + randomBytes(16).toString('hex');
  const apiKey = 'pm_test_' + randomBytes(16).toString('hex');
  const hashes = await makeSeedHashes(password, apiKey);
  await db.user.create({ data: {
    id: 'unrelated-user', email: 'unrelated@example.test',
    name: 'Keep this record', passwordHash: 'test-only-unrelated-record',
  } });
  const first = await db.$transaction((tx) => seedDemo(tx, hashes));
  assert.equal(first.count, 5);
  const originalEvents = await db.telemetryEvent.findMany({ orderBy: { eventId: 'asc' } });
  const originalUser = await db.user.findUniqueOrThrow({ where: { id: demoIds.user } });
  assert.ok(await verify(originalUser.passwordHash, password));
  const originalKey = await db.apiKey.findUniqueOrThrow({ where: { id: demoIds.key } });
  assert.equal(originalKey.keyHash, hashes.keyHash);
  assert.notEqual(originalKey.keyHash, apiKey);

  // Simulate owner edits and a revoked key; rerunning seed must not undo them.
  const revokedAt = new Date('2026-01-01T00:00:00Z');
  await db.project.update({ where: { id: demoIds.project }, data: { name: 'Owner edit' } });
  await db.apiKey.update({ where: { id: demoIds.key }, data: { revokedAt } });
  const newHashes = await makeSeedHashes(password + '-changed', apiKey + '-changed');
  const second = await db.$transaction((tx) => seedDemo(tx, newHashes));
  assert.equal(second.count, 0);
  assert.equal(await db.user.count(), 2);
  assert.equal(await db.project.count(), 1);
  assert.equal(await db.apiKey.count(), 1);
  assert.equal(await db.telemetryEvent.count(), 5);
  assert.deepEqual(await db.telemetryEvent.findMany({ orderBy: { eventId: 'asc' } }), originalEvents);
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: demoIds.user } }), originalUser);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: 'unrelated-user' } })).name, 'Keep this record');
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: demoIds.project } })).name, 'Owner edit');
  const preservedKey = await db.apiKey.findUniqueOrThrow({ where: { id: demoIds.key } });
  assert.equal(preservedKey.keyHash, originalKey.keyHash);
  assert.equal(preservedKey.revokedAt?.toISOString(), revokedAt.toISOString());
  console.log('PASS: seed twice preserves unrelated rows, edits, credentials, timestamps and revocation.');
  console.log('PASS: demo password verifies as Argon2 and key stores only its SHA-256 hash.');

  stage = 'foreign keys and uniqueness';
  const { id: _id, ...event } = originalEvents[0]!;
  await assert.rejects(db.telemetryEvent.create({ data: event }), { code: 'P2002' });
  const anotherProject = await db.project.create({ data: {
    userId: 'unrelated-user', name: 'Other project', environment: 'test',
  } });
  await db.telemetryEvent.create({ data: { ...event, projectId: anotherProject.id } });
  console.log('PASS: repeated event ID rejected within a project, accepted in another project.');

  await assert.rejects(db.telemetryEvent.create({
    data: { ...event, eventId: 'invalid-foreign-key', projectId: 'missing-project' },
  }), { code: 'P2003' });
  await assert.rejects(db.user.create({ data: {
    name: 'Duplicate', email: originalUser.email, passwordHash: 'test-only',
  } }), { code: 'P2002' });
  await assert.rejects(db.project.delete({ where: { id: demoIds.project } }), { code: 'P2003' });
  console.log('PASS: foreign keys, unique user email and restricted parent deletion enforced.');

  stage = 'index verification';
  const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName}
  `;
  const names = indexes.map((index) => index.indexname);
  assert.ok(names.includes('TelemetryEvent_projectId_timestamp_idx'));
  assert.ok(names.includes('TelemetryEvent_projectId_eventId_key'));
  assert.ok(!names.includes('TelemetryEvent_eventId_key'));
  console.log('PASS: project/time index and project/event unique index exist.');
}

main()
  .catch(() => {
    console.error('Database verification failed at: ' + stage + '. Check Docker, local configuration and migrations.');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await checks?.$disconnect();
      if (schemaCreated) {
        // schemaName is generated here, validated above, never provided by a user.
        await admin.$executeRawUnsafe('DROP SCHEMA "' + schemaName + '" CASCADE');
        console.log('Removed only the isolated verification schema.');
      }
    } catch {
      console.error('Verification cleanup failed; temporary schema: ' + schemaName);
      process.exitCode = 1;
    } finally {
      await admin.$disconnect();
    }
  });
