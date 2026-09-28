const assert = require('node:assert/strict');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const { randomBytes, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { Router } = require('express');
const { createApp } = require('../../dist/app.js');
const { createAuthRoutes } = require('../../dist/routes/auth.route.js');
const origin = 'http://localhost:5173';
const schema = 'phase3_check_' + randomBytes(8).toString('hex');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/pulsemonitor');
const admin = new PrismaClient();
let db, created = false, server, base, logs;
const password = 'test-' + randomBytes(24).toString('hex');
const credentials = { email: 'owner@example.test', password };
const safeUser = { id: 'owner', name: 'Owner', email: credentials.email };
const cookieFrom = response => response.headers.get('set-cookie').split(';')[0];
async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  return fetch(base + '/api/v1/auth' + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-PulseMonitor-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
before(async () => {
  assert.match(schema, /^phase3_check_[a-f0-9]{16}$/);
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
    { ...safeUser, passwordHash },
    { id: 'other', name: 'Other', email: 'other@example.test', passwordHash },
  ] });
});
beforeEach(async t => {
  await db.session.deleteMany();
  logs = [];
  t.mock.method(console, 'info', value => logs.push(value));
  t.mock.method(console, 'error', value => logs.push(value));
  const routes = Router();
  routes.use('/api/v1/auth', createAuthRoutes(db, origin));
  server = createApp(routes).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
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

test('login protects the cookie, stores only its hash, and returns a safe current user', async () => {
  const response = await request('/login', { method: 'POST', body: { ...credentials, email: ' OWNER@example.test ' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: safeUser });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=28800/);
  const cookie = cookieFrom(response);
  const token = cookie.split('=')[1];
  const row = await db.session.findUniqueOrThrow({ where: { userId: 'owner' } });
  assert.equal(row.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.ok(row.expiresAt.getTime() > Date.now() + 7 * 3600000);
  const me = await request('/me', { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: safeUser });
  for (const secret of [password, token, row.tokenHash, credentials.email]) assert.ok(!logs.join('\n').includes(secret));
});
test('wrong password and unknown email return the same safe error', async () => {
  const errors = [];
  for (const body of [{ ...credentials, password: 'wrong' }, { ...credentials, email: 'missing@example.test' }]) {
    const response = await request('/login', { method: 'POST', body });
    assert.equal(response.status, 401);
    const data = await response.json();
    errors.push({ code: data.error.code, message: data.error.message });
    assert.ok(!JSON.stringify(data).includes(password));
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.equal(await db.session.count(), 0);
});
test('malformed credentials and JSON fail safely', async () => {
  for (const body of [{}, { email: 'bad', password }, { ...credentials, password: 1 }, { ...credentials, extra: 'secret' }, { ...credentials, password: 'x'.repeat(129) }]) {
    assert.equal((await request('/login', { method: 'POST', body })).status, 400);
  }
  const response = await fetch(base + '/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PulseMonitor-Request': '1' }, body: '{',
  });
  assert.equal(response.status, 400);
});
test('missing, malformed, fabricated and expired sessions are rejected', async () => {
  for (const cookie of [undefined, 'pm_session=bad', 'pm_session=' + 'a'.repeat(64)]) {
    assert.equal((await request('/me', { cookie })).status, 401);
  }
  const login = await request('/login', { method: 'POST', body: credentials });
  await db.session.update({ where: { userId: 'owner' }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/me', { cookie: cookieFrom(login) })).status, 401);
});
test('logout invalidates a captured cookie in the database', async () => {
  const cookie = cookieFrom(await request('/login', { method: 'POST', body: credentials }));
  const response = await request('/logout', { method: 'POST', cookie });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal(await db.session.count(), 0);
  assert.equal((await request('/me', { cookie })).status, 401);
});
test('new login replaces the old session and users remain isolated', async () => {
  const first = cookieFrom(await request('/login', { method: 'POST', body: credentials }));
  const second = cookieFrom(await request('/login', { method: 'POST', body: credentials }));
  const other = cookieFrom(await request('/login', { method: 'POST', body: { ...credentials, email: 'other@example.test' } }));
  assert.equal((await request('/me', { cookie: first })).status, 401);
  assert.deepEqual(await (await request('/me', { cookie: second })).json(), { user: safeUser });
  assert.equal((await (await request('/me', { cookie: other })).json()).user.id, 'other');
  await request('/logout', { method: 'POST', cookie: second });
  assert.equal((await request('/me', { cookie: other })).status, 200);
  assert.equal(await db.session.count(), 1);
});
test('origin and custom-header checks protect writes and allow configured preflight', async () => {
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'X-PulseMonitor-Request': '' }]) {
    assert.equal((await request('/login', { method: 'POST', body: credentials, headers })).status, 403);
  }
  const preflight = await request('/login', { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-pulsemonitor-request',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const login = await request('/login', { method: 'POST', body: credentials, headers: { Origin: origin } });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  assert.equal((await request('/logout', { method: 'POST', cookie, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/me', { cookie })).status, 200);
});
test('login attempts are bounded and forwarded headers cannot bypass the limit', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await request('/login', { method: 'POST', body: {} })).status, 400);
  const response = await request('/login', { method: 'POST', body: credentials, headers: { 'X-Forwarded-For': '192.0.2.123' } });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal(await db.session.count(), 0);
});
test('production cookies include Secure', async () => {
  const routes = Router();
  routes.use('/api/v1/auth', createAuthRoutes(db, origin, true));
  const secureServer = createApp(routes).listen(0, '127.0.0.1');
  await once(secureServer, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + secureServer.address().port + '/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PulseMonitor-Request': '1' }, body: JSON.stringify(credentials),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
  } finally { await new Promise(resolve => secureServer.close(resolve)); }
});
