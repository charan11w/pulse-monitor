const assert = require('node:assert/strict');
const { once } = require('node:events');
const { before, after, beforeEach, afterEach, test, mock } = require('node:test');
const { Router } = require('express');
const { z } = require('zod');
const { createApp } = require('../dist/app.js');
const healthRoutes = require('../dist/routes/health.route.js').default;
const { validateBody } = require('../dist/middleware/validate.middleware.js');
const { AppError } = require('../dist/utils/app-error.js');

let server;
let baseUrl;
let requestLog;
let errorLog;

// These routes exist only in this test process, never in the shipped API.
before(async () => {
  const routes = Router();
  routes.use(healthRoutes);
  routes.post('/validate', validateBody(z.object({
    name: z.string().trim().min(1),
  })), (req, res) => res.json(req.body));
  routes.get('/expected', () => {
    throw new AppError('Example conflict', 409, 'CONFLICT');
  });
  routes.get('/unexpected', () => {
    throw new Error('private-database-password');
  });
  routes.get('/async-error', async () => {
    throw new Error('private-async-secret');
  });
  routes.get('/server-error', () => {
    throw new AppError('private-internal-details', 503, 'PRIVATE_CODE');
  });
  routes.get('/items/:id', (_req, res) => res.json({ success: true }));
  server = createApp(routes).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

beforeEach(() => {
  requestLog = mock.method(console, 'info', () => {});
  errorLog = mock.method(console, 'error', () => {});
});

afterEach(() => mock.restoreAll());
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  return { response, body: await response.json() };
}

function assertError(result, status, code, message) {
  assert.equal(result.response.status, status);
  const requestId = result.response.headers.get('x-request-id');
  assert.match(requestId, /^req_[0-9a-f-]{36}$/);
  assert.deepEqual(result.body, {
    success: false,
    error: { code, message, requestId },
  });
}

function loggedRequests() {
  return requestLog.mock.calls.map((call) => JSON.parse(call.arguments[0]));
}

test('health works and request IDs are generated rather than trusted', async () => {
  const first = await request('/health', { headers: { 'x-request-id': 'untrusted' } });
  const second = await request('/health');
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body, { success: true });
  assert.match(first.response.headers.get('x-request-id'), /^req_[0-9a-f-]{36}$/);
  assert.notEqual(first.response.headers.get('x-request-id'), second.response.headers.get('x-request-id'));
});

test('unknown routes use the 404 error contract', async () => {
  assertError(await request('/missing'), 404, 'NOT_FOUND', 'Route not found');
});

test('malformed JSON is 400 with a request ID, without reflecting the body', async () => {
  const result = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"private-token":',
  });
  assertError(result, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  assert.equal(loggedRequests()[0].status, 400);
  assert.equal(errorLog.mock.callCount(), 0);
  assert.ok(!JSON.stringify(loggedRequests()).includes('private-token'));
});

test('bodies above 100kb are rejected with 413', async () => {
  assertError(await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(103000) }),
  }), 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the 100kb limit');
});

test('unsupported JSON charset has a safe 415 response', async () => {
  assertError(await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=iso-8859-1' },
    body: '{}',
  }), 415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
});

test('schema validation rejects invalid fields without echoing submitted values', async () => {
  assertError(await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 42, password: 'private-validation-secret' }),
  }), 400, 'VALIDATION_ERROR', 'Request validation failed');
});

test('schema validation rejects a missing body', async () => {
  assertError(await request('/validate', { method: 'POST' }),
    400, 'VALIDATION_ERROR', 'Request validation failed');
});

test('valid input reaches the handler as parsed data', async () => {
  const result = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '  Charan  ', extra: 'not part of schema' }),
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { name: 'Charan' });
});

test('intentional client errors keep their public status and message', async () => {
  assertError(await request('/expected'), 409, 'CONFLICT', 'Example conflict');
});

for (const path of ['/unexpected', '/async-error', '/server-error']) {
  test(path + ' hides internal details and correlates the failure log', async () => {
    const result = await request(path);
    assertError(result, 500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error');
    assert.equal(errorLog.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(errorLog.mock.calls[0].arguments[0]), {
      event: 'request_failed',
      requestId: result.body.error.requestId,
      code: 'INTERNAL_SERVER_ERROR',
    });
    assert.ok(!JSON.stringify(loggedRequests()).includes('private-'));
  });
}

test('completion logs use route templates and exclude query, header and body secrets', async () => {
  const result = await request('/items/private-path-value?token=private-query', {
    headers: { authorization: 'Bearer private-header' },
  });
  await request('/validate?token=private-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'private-body' }),
  });
  const records = loggedRequests();
  assert.equal(records.length, 2);
  const record = records[0];
  assert.deepEqual(Object.keys(record).sort(),
    ['event', 'requestId', 'method', 'path', 'status', 'durationMs'].sort());
  assert.equal(record.event, 'request_completed');
  assert.equal(record.requestId, result.response.headers.get('x-request-id'));
  assert.equal(record.method, 'GET');
  assert.equal(record.path, '/items/:id');
  assert.equal(record.status, 200);
  assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0);
  assert.ok(!JSON.stringify(records).includes('private-'));
});

test('unknown URL paths are redacted from logs', async () => {
  await request('/private-path-value?token=private-query');
  assert.equal(loggedRequests()[0].path, '[unmatched]');
  assert.ok(!JSON.stringify(loggedRequests()).includes('private-'));
});
