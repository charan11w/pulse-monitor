const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('../dist/config/env-schema.js');

test('configuration defaults are numeric port 3000 and development mode', () => {
  assert.deepEqual(parseEnv({}), { PORT: 3000, NODE_ENV: 'development' });
});

test('valid environment strings are parsed and unrelated variables ignored', () => {
  assert.deepEqual(parseEnv({ PORT: '4200', NODE_ENV: 'test', UNRELATED: 'value' }),
    { PORT: 4200, NODE_ENV: 'test' });
});

test('invalid ports and modes fail with variable names but no submitted values', () => {
  for (const value of ['', '0', '-1', '65536', '3.14', '3000abc', 'private-config-secret']) {
    assert.throws(() => parseEnv({ PORT: value }), {
      message: 'Invalid environment configuration: PORT',
    });
  }
  assert.throws(() => parseEnv({ NODE_ENV: 'private-config-secret' }), {
    message: 'Invalid environment configuration: NODE_ENV',
  });
});

test('compiled server refuses invalid startup configuration', () => {
  const result = spawnSync(process.execPath, ['dist/server.js'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, PORT: 'private-config-secret', NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid environment configuration: PORT/);
  assert.ok(!result.stderr.includes('private-config-secret'));
  assert.ok(!result.stdout.includes('server_started'));
});
