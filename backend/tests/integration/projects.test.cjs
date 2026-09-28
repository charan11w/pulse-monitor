const assert = require('node:assert/strict');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { Router } = require('express');
const { createApp } = require('../../dist/app.js');
const { createAuthRoutes } = require('../../dist/routes/auth.route.js');
const { createProjectRoutes } = require('../../dist/routes/project.route.js');
const { requireApiKey } = require('../../dist/middleware/api-key.middleware.js');

const origin = 'http://localhost:5173';
const schema = 'phase4_check_' + randomBytes(8).toString('hex');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/pulsemonitor');
const admin = new PrismaClient();
const password = 'test-' + randomBytes(24).toString('hex');
const owner = randomUUID(), other = randomUUID();
let db, created = false, server, base, cookies, logs;
const digest = key => createHash('sha256').update(key).digest('hex');
async function request(path, { method = 'GET', body, cookie = cookies?.owner, headers = {} } = {}) {
  return fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-PulseMonitor-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const projectsPath = '/api/v1/projects';
async function createProject(name = 'My API', cookie = cookies.owner) {
  const response = await request(projectsPath, { method: 'POST', body: { name }, cookie });
  assert.equal(response.status, 201);
  return (await response.json()).project;
}
async function createKey(projectId, cookie = cookies.owner) {
  const response = await request(`${projectsPath}/${projectId}/keys`, {
    method: 'POST', body: { name: 'SDK key' }, cookie,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
async function sender(key, body = {}) {
  return request('/_test/sender', { method: 'POST', body, cookie: null,
    headers: key === undefined ? {} : { 'X-API-Key': key } });
}

before(async () => {
  assert.match(schema, /^phase4_check_[a-f0-9]{16}$/);
  await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
  created = true;
  url.searchParams.set('schema', schema);
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  assert.equal(migrated.status, 0, 'isolated migrations must succeed');
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const passwordHash = await argon2.hash(password);
  await db.user.createMany({ data: [
    { id: owner, name: 'Owner', email: 'owner@example.test', passwordHash },
    { id: other, name: 'Other', email: 'other@example.test', passwordHash },
  ] });
});
beforeEach(async t => {
  // This client is restricted to the generated test schema.
  await db.apiKey.deleteMany();
  await db.project.deleteMany();
  await db.session.deleteMany();
  logs = [];
  t.mock.method(console, 'info', value => logs.push(value));
  t.mock.method(console, 'error', value => logs.push(value));
  const routes = Router();
  routes.use('/api/v1/auth', createAuthRoutes(db, origin));
  routes.use(projectsPath, createProjectRoutes(db, origin));
  // Exercise the real middleware without adding a phase-5 endpoint to the application.
  routes.post('/_test/sender', requireApiKey(db), (req, res) => res.json(req.telemetrySource));
  server = createApp(routes).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  cookies = {};
  for (const name of ['owner', 'other']) {
    const response = await request('/api/v1/auth/login', {
      method: 'POST', cookie: null, body: { email: name + '@example.test', password },
    });
    assert.equal(response.status, 200);
    cookies[name] = response.headers.get('set-cookie').split(';')[0];
  }
});
afterEach(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
after(async () => {
  await db?.$disconnect();
  try {
    if (created) await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
  } finally { await admin.$disconnect(); }
});

test('create/list/get projects use the session owner and return safe fields', async () => {
  const response = await request(projectsPath, { method: 'POST', body: {
    name: '  Orders API  ', description: '  Interview demo  ', environment: 'staging',
  } });
  assert.equal(response.status, 201);
  const { project } = await response.json();
  assert.equal(project.name, 'Orders API');
  assert.equal(project.description, 'Interview demo');
  assert.equal(project.environment, 'staging');
  assert.deepEqual(Object.keys(project).sort(), ['id', 'name', 'description', 'environment', 'createdAt', 'updatedAt'].sort());
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).userId, owner);
  assert.deepEqual(await (await request(`${projectsPath}/${project.id}`)).json(), { project });
  await createProject('Other API', cookies.other);
  const list = await request(projectsPath);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await list.json()).projects, [project]);
});

test('every management operation requires a user session; an API key cannot replace it', async () => {
  const project = await createProject();
  const key = await createKey(project.id);
  for (const [path, method, body] of [
    [projectsPath, 'GET'], [projectsPath, 'POST', { name: 'Blocked' }],
    [`${projectsPath}/${project.id}`, 'GET'], [`${projectsPath}/${project.id}/keys`, 'GET'],
    [`${projectsPath}/${project.id}/keys`, 'POST', { name: 'Blocked' }],
    [`${projectsPath}/${project.id}/keys/${key.apiKey.id}/revoke`, 'POST'],
  ]) {
    assert.equal((await request(path, { method, body, cookie: null, headers: { 'X-API-Key': key.rawKey } })).status, 401);
  }
  assert.equal(await db.apiKey.count(), 1);
  assert.equal(await db.project.count(), 1);
});

test('two-user isolation rejects project reads, key listing, creation and revocation', async () => {
  const foreign = await createProject('Foreign API', cookies.other);
  const key = await createKey(foreign.id, cookies.other);
  for (const [suffix, method, body] of [
    ['', 'GET'], ['/keys', 'GET'], ['/keys', 'POST', { name: 'Stolen' }],
    [`/keys/${key.apiKey.id}/revoke`, 'POST'],
  ]) {
    const response = await request(`${projectsPath}/${foreign.id}${suffix}`, { method, body });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'PROJECT_NOT_FOUND');
  }
  assert.equal((await request(`${projectsPath}/${randomUUID()}`)).status, 404);
  assert.deepEqual((await (await request(projectsPath)).json()).projects, []);
  assert.equal(await db.apiKey.count(), 1);
  assert.equal((await sender(key.rawKey)).status, 200);
});

test('key IDs are scoped to the URL project even across two owned projects', async () => {
  const first = await createProject('First'), second = await createProject('Second');
  const key = await createKey(first.id);
  const response = await request(`${projectsPath}/${second.id}/keys/${key.apiKey.id}/revoke`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'API_KEY_NOT_FOUND');
  assert.equal((await sender(key.rawKey)).status, 200);
  const missing = await request(`${projectsPath}/${first.id}/keys/${randomUUID()}/revoke`, { method: 'POST' });
  assert.equal(missing.status, 404);
});

test('validation bounds fields, IDs, pagination and rejects supplied ownership or hashes', async () => {
  for (const body of [{}, { name: ' ' }, { name: 'x'.repeat(81) }, { name: 'ok', description: 'x'.repeat(501) },
    { name: 'ok', environment: 'unknown' }, { name: 'ok', userId: other }]) {
    assert.equal((await request(projectsPath, { method: 'POST', body })).status, 400);
  }
  assert.equal(await db.project.count(), 0);
  const project = await createProject();
  for (const body of [{}, { name: ' ' }, { name: 'x'.repeat(81) }, { name: 'ok', keyHash: 'injected' }, { name: 'ok', projectId: randomUUID() }]) {
    assert.equal((await request(`${projectsPath}/${project.id}/keys`, { method: 'POST', body })).status, 400);
  }
  for (const query of ['page=0', 'page=1001', 'pageSize=51', 'pageSize=-1', 'page=1.1', 'page=1&page=2', 'userId=someone']) {
    for (const path of [projectsPath, `${projectsPath}/${project.id}/keys`]) {
      assert.equal((await request(path + '?' + query)).status, 400);
    }
  }
  assert.equal((await request(projectsPath + '/invalid-id')).status, 400);
  assert.equal((await request(`${projectsPath}/${project.id}/keys/invalid/revoke`, { method: 'POST' })).status, 400);
  assert.equal(await db.apiKey.count(), 0);
});

test('raw keys appear only at creation; stored/listed metadata and logs omit credentials', async () => {
  const project = await createProject();
  const first = await createKey(project.id), second = await createKey(project.id);
  assert.match(first.rawKey, /^pm_key_[a-f0-9]{64}$/);
  assert.notEqual(first.rawKey, second.rawKey);
  assert.equal(first.apiKey.keyPrefix, first.rawKey.slice(0, 12));
  assert.deepEqual(Object.keys(first.apiKey).sort(), ['id', 'name', 'keyPrefix', 'createdAt', 'revokedAt'].sort());
  const stored = await db.apiKey.findUniqueOrThrow({ where: { id: first.apiKey.id } });
  assert.equal(stored.keyHash, digest(first.rawKey));
  assert.ok(!JSON.stringify(stored).includes(first.rawKey));
  await assert.rejects(db.apiKey.create({ data: {
    projectId: project.id, name: 'Duplicate hash', keyHash: stored.keyHash, keyPrefix: stored.keyPrefix,
  } }), { code: 'P2002' });
  const response = await request(`${projectsPath}/${project.id}/keys`);
  const list = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(list.apiKeys.length, 2);
  for (const secret of [first.rawKey, second.rawKey, stored.keyHash, password]) {
    assert.ok(!JSON.stringify(list).includes(secret));
    assert.ok(!logs.join('\n').includes(secret));
  }
});

test('sender authentication derives project from the key and rejects missing or invalid keys', async () => {
  const project = await createProject();
  const key = await createKey(project.id);
  const result = await sender(key.rawKey, { projectId: randomUUID(), userId: other });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { projectId: project.id, apiKeyId: key.apiKey.id });
  for (const invalid of [undefined, '', 'bad', 'x'.repeat(129), 'a'.repeat(64), key.rawKey + ',another']) {
    const response = await sender(invalid);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'INVALID_API_KEY');
  }
  assert.equal((await request('/_test/sender', { method: 'POST', body: {} })).status, 401);
  assert.ok(!logs.join('\n').includes(key.rawKey));
});

test('revocation is immediate for subsequent authentication and repeatable without timestamp changes', async () => {
  const project = await createProject();
  const key = await createKey(project.id), retained = await createKey(project.id);
  assert.equal((await sender(key.rawKey)).status, 200);
  const path = `${projectsPath}/${project.id}/keys/${key.apiKey.id}/revoke`;
  assert.equal((await request(path, { method: 'POST' })).status, 204);
  const before = await db.apiKey.findUniqueOrThrow({ where: { id: key.apiKey.id } });
  assert.ok(before.revokedAt instanceof Date);
  assert.equal((await sender(key.rawKey)).status, 401);
  assert.equal((await sender(retained.rawKey)).status, 200);
  assert.equal((await request(path, { method: 'POST' })).status, 204);
  assert.deepEqual(await db.apiKey.findUniqueOrThrow({ where: { id: key.apiKey.id } }), before);
  const list = await (await request(`${projectsPath}/${project.id}/keys`)).json();
  assert.equal(list.apiKeys.find(item => item.id === key.apiKey.id).revokedAt, before.revokedAt.toISOString());
});

test('project and key listings have bounded stable pages and never mix owners', async () => {
  const timestamp = new Date('2026-01-01');
  await db.project.createMany({ data: Array.from({ length: 52 }, (_, i) => ({
    userId: owner, name: 'Project ' + i, environment: 'test', createdAt: timestamp,
  })) });
  await createProject('Foreign', cookies.other);
  const first = await (await request(projectsPath + '?pageSize=50')).json();
  const second = await (await request(projectsPath + '?pageSize=50&page=2')).json();
  assert.equal(first.projects.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.projects.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.projects, ...second.projects].map(item => item.id)).size, 52);
  assert.equal((await (await request(projectsPath)).json()).projects.length, 20);
  const projectId = first.projects[0].id;
  await db.apiKey.createMany({ data: Array.from({ length: 3 }, (_, i) => ({
    projectId, name: 'Key ' + i, keyHash: digest(randomBytes(32)), keyPrefix: 'pm_test', createdAt: timestamp,
  })) });
  const keys = `${projectsPath}/${projectId}/keys?pageSize=2`;
  const a = await (await request(keys)).json(), b = await (await request(keys + '&page=2')).json();
  assert.equal(a.apiKeys.length, 2);
  assert.equal(a.hasMore, true);
  assert.equal(b.apiKeys.length, 1);
  assert.equal(b.hasMore, false);
  assert.equal(new Set([...a.apiKeys, ...b.apiKeys].map(item => item.id)).size, 3);
});

test('management writes retain origin/custom-header protection and configured preflight', async () => {
  const project = await createProject();
  const key = await createKey(project.id);
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-PulseMonitor-Request': '' }]) {
    for (const [path, body] of [[projectsPath, { name: 'Blocked' }],
      [`${projectsPath}/${project.id}/keys`, { name: 'Blocked' }],
      [`${projectsPath}/${project.id}/keys/${key.apiKey.id}/revoke`, undefined]]) {
      assert.equal((await request(path, { method: 'POST', body, headers })).status, 403);
    }
  }
  const preflight = await request(projectsPath, { method: 'OPTIONS', cookie: null,
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(await db.project.count(), 1);
  assert.equal(await db.apiKey.count(), 1);
  assert.equal((await sender(key.rawKey)).status, 200);
});

test('existing generated seed-key format remains usable', async () => {
  const project = await createProject();
  const rawKey = 'pm_dev_' + randomBytes(24).toString('hex');
  const key = await db.apiKey.create({ data: {
    projectId: project.id, name: 'Seed-compatible key', keyHash: digest(rawKey), keyPrefix: rawKey.slice(0, 12),
  } });
  assert.deepEqual(await (await sender(rawKey)).json(), { projectId: project.id, apiKeyId: key.id });
});
