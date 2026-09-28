// Isolated local PostgreSQL/Redis only; never loads configured remote credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

const names = ['logistics-i1-postgres', 'logistics-i1-redis'];
const containers = JSON.parse(execFileSync('docker', ['inspect', ...names], { encoding: 'utf8' }));
for (const container of containers) {
  if (!container.State.Running) execFileSync('docker', ['start', container.Name.slice(1)], { stdio: 'ignore' });
}
const config = Object.fromEntries(containers[0].Config.Env.map((entry) => {
  const index = entry.indexOf('=');
  return [entry.slice(0, index), entry.slice(index + 1)];
}));
const connection = { host: '127.0.0.1', port: 55432, user: config.POSTGRES_USER ?? 'postgres', password: config.POSTGRES_PASSWORD, database: 'postgres' };
let admin;
for (let attempt = 0; attempt < 30; attempt++) {
  admin = new pg.Client(connection);
  try { await admin.connect(); break; }
  catch (error) {
    await admin.end();
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
const database = `p0_regression_${Date.now()}`;
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
  const paths = process.argv.slice(2);
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '../node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', '--runTestsByPath',
    ...(paths.length ? paths : ['test/p0-auth-races.e2e-spec.ts', 'test/auth.e2e-spec.ts', 'test/operational-flow.e2e-spec.ts', 'test/phase-h1.e2e-spec.ts', 'test/phase-h2.e2e-spec.ts', 'test/phase-h3.e2e-spec.ts', 'test/phase5.e2e-spec.ts'])], {
    cwd: 'backend', stdio: 'inherit',
    env: { ...process.env, P0_REGRESSION: 'true', DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), JWT_ACCESS_SECRET: 'local-p0-regression-only-secret-32-characters', REDIS_URL: 'redis://127.0.0.1:56379/2', ROUTE_PROVIDER: 'DISABLED' },
  });
  process.exitCode = result.status ?? 1;
} finally { await admin.end(); }
