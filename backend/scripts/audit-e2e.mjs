import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

// Dedicated Redis only: clear rate-limit counters between suites, never weaken app limits.
const database = new URL(process.env.DATABASE_URL ?? '');
const redisUrl = new URL(process.env.REDIS_URL ?? '');
if (database.hostname !== '127.0.0.1' || !database.pathname.startsWith('/i1_') ||
    redisUrl.hostname !== '127.0.0.1' || redisUrl.port !== '56379') {
  throw new Error('Audit E2E requires disposable local i1_* PostgreSQL and Redis port 56379');
}
const backend = fileURLToPath(new URL('../', import.meta.url));
const jest = fileURLToPath(new URL('../../node_modules/jest/bin/jest.js', import.meta.url));
const files = (await readdir(new URL('../test/', import.meta.url)))
  .filter((name) => name.endsWith('.e2e-spec.ts')).sort();
const redis = new Redis(redisUrl.toString(), { maxRetriesPerRequest: 1 });
let failures = 0;
try {
  for (const file of files) {
    const keys = await redis.keys('rate-limit:*');
    if (keys.length) await redis.del(...keys);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-vm-modules', jest,
        '--config', 'test/jest-e2e.json', '--runInBand', '--runTestsByPath', `test/${file}`],
      { cwd: backend, env: process.env, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    console.log(`I1_SUITE ${code === 0 ? 'PASS' : 'FAIL'} ${file}`);
    if (code !== 0) failures++;
  }
} finally {
  redis.disconnect();
}
console.log(`I1_E2E ${files.length - failures}/${files.length} suites passed`);
process.exitCode = failures ? 1 : 0;
