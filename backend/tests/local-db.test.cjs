const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readLocalConfig } = require('../scripts/local-db.cjs');

const secrets = [
  'POSTGRES_PASSWORD=' + 'a'.repeat(48),
  'SEED_PASSWORD=' + 'b'.repeat(48),
  'SEED_API_KEY=pm_dev_' + 'c'.repeat(48),
].join('\n');

test('local DB configuration always targets loopback and ignores a supplied database URL', () => {
  const config = readLocalConfig(secrets + '\nDATABASE_URL=postgresql://remote.example/prod');
  const url = new URL(config.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/pulsemonitor');
  assert.equal(url.username, 'pulsemonitor');
  assert.equal(url.searchParams.get('schema'), 'public');
});

test('local DB configuration supports a custom local port', () => {
  assert.equal(new URL(readLocalConfig(secrets + '\nPOSTGRES_PORT=5444').DATABASE_URL).port, '5444');
});

test('local DB configuration rejects invalid ports and placeholder credentials', () => {
  for (const port of ['0', '65536', 'NaN', '5433/remote']) {
    assert.throws(() => readLocalConfig(secrets + '\nPOSTGRES_PORT=' + port), /POSTGRES_PORT/);
  }
  assert.throws(() => readLocalConfig(secrets.replace('a'.repeat(48), 'replace-with-random-secret')), /POSTGRES_PASSWORD/);
});

test('local DB errors report field names rather than submitted secrets', () => {
  const invalid = 'sensitive$value';
  assert.throws(() => readLocalConfig(secrets.replace('b'.repeat(48), invalid)), (error) => {
    assert.match(error.message, /SEED_PASSWORD/);
    assert.ok(!error.message.includes(invalid));
    return true;
  });
});
