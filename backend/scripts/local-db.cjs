const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(rootDir, '.env');

function readLocalConfig(text) {
  const values = dotenv.parse(text);
  const port = values.POSTGRES_PORT || '5433';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535.');
  }
  for (const key of ['POSTGRES_PASSWORD', 'SEED_PASSWORD', 'SEED_API_KEY']) {
    // Hex-generated secrets need no special Compose interpolation escaping.
    if (!/^[a-zA-Z0-9_-]{24,128}$/.test(values[key] || '') ||
        values[key].startsWith('replace-')) {
      throw new Error(key + ' must be a generated local secret (24-128 letters, digits, _ or -).');
    }
  }
  return {
    ...values,
    POSTGRES_PORT: port,
    // Never use DATABASE_URL from an existing backend/.env or parent shell.
    DATABASE_URL: 'postgresql://pulsemonitor:' + encodeURIComponent(values.POSTGRES_PASSWORD)
      + '@127.0.0.1:' + port + '/pulsemonitor?schema=public',
  };
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: backendDir, env, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) {
    throw new Error(command === 'docker'
      ? 'Docker is unavailable. Install/start Docker Desktop, then reopen your terminal.'
      : 'Could not start the database command.');
  }
  if (result.status !== 0) process.exitCode = result.status || 1;
}

function main(action) {
  if (action === 'init') {
    try {
      fs.writeFileSync(envPath,
        '# Generated local-only credentials. Do not commit or share.\n'
        + 'POSTGRES_PORT=5433\n'
        + 'POSTGRES_PASSWORD=' + randomBytes(24).toString('hex') + '\n'
        + 'SEED_PASSWORD=' + randomBytes(24).toString('hex') + '\n'
        + 'SEED_API_KEY=pm_dev_' + randomBytes(24).toString('hex') + '\n',
        { flag: 'wx', mode: 0o600 });
      console.log('Created root .env with random local credentials; values are not printed.');
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error('Could not create root .env.');
      console.log('Root .env already exists; left unchanged.');
    }
  }

  if (!fs.existsSync(envPath)) throw new Error('Run npm run db:init first.');
  const localConfig = readLocalConfig(fs.readFileSync(envPath, 'utf8'));
  const env = { ...process.env, ...localConfig };
  const compose = ['compose', '--env-file', envPath, '-f', path.join(rootDir, 'compose.yaml')];
  const prisma = path.join(backendDir, 'node_modules/prisma/build/index.js');
  switch (action) {
    case 'init': return;
    case 'start': return run('docker', [...compose, 'up', '-d', '--wait', 'postgres'], env);
    case 'stop': return run('docker', [...compose, 'stop', 'postgres'], env);
    case 'status': return run('docker', [...compose, 'ps'], env);
    case 'generate': return run(process.execPath, [prisma, 'generate'], env);
    case 'validate': return run(process.execPath, [prisma, 'validate'], env);
    case 'migrate': return run(process.execPath, [prisma, 'migrate', 'deploy'], env);
    case 'migrations': return run(process.execPath, [prisma, 'migrate', 'status'], env);
    case 'seed': return run(process.execPath, ['dist-prisma/seed.js'], env);
    case 'verify': return run(process.execPath, ['dist-prisma/verify.js'], env);
    case 'snapshot': return run(process.execPath, ['dist-prisma/snapshot.js'], env);
    default: throw new Error('Unknown local database action.');
  }
}

module.exports = { readLocalConfig };
if (require.main === module) {
  try { main(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
