// Explicit isolated localhost integration runner. Never uses configured remote DB credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

const [container] = JSON.parse(execFileSync('docker', ['inspect', 'logistics-i1-postgres'], { encoding: 'utf8' }));
if (!container.State.Running) execFileSync('docker', ['start', 'logistics-i1-postgres'], { stdio: 'ignore' });
const env = Object.fromEntries(container.Config.Env.map((item) => {
  const index = item.indexOf('=');
  return [item.slice(0, index), item.slice(index + 1)];
}));
const connection = { host: '127.0.0.1', port: 55432, user: env.POSTGRES_USER ?? 'postgres', password: env.POSTGRES_PASSWORD, database: 'postgres' };
let admin;
for (let attempt = 0; attempt < 20; attempt++) {
  admin = new pg.Client(connection);
  try { await admin.connect(); break; }
  catch (error) {
    await admin.end();
    if (attempt === 19) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const database = `cod_location_${Date.now()}`;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  const db = new pg.Client({ ...connection, database });
  await db.connect();
  try {
    for (const migration of readdirSync('backend/prisma/migrations').filter((name) => /^\d/.test(name)).sort()) {
      await db.query(readFileSync(`backend/prisma/migrations/${migration}/migration.sql`, 'utf8'));
    }
  } finally { await db.end(); }
  console.log(`Prepared isolated localhost database ${database}`);
  const url = new URL(`postgresql://127.0.0.1:55432/${database}`);
  url.username = connection.user;
  url.password = connection.password;
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '../node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', '--runTestsByPath', 'test/phase7.e2e-spec.ts'], {
    cwd: 'backend', stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), JWT_ACCESS_SECRET: 'local-cod-verification-only-secret-32-characters', REDIS_URL: 'redis://127.0.0.1:56379/0', ROUTE_PROVIDER: 'DISABLED' },
  });
  process.exitCode = run.status ?? 1;
} finally {
  await admin.end();
}
