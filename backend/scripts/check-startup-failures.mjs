import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

// Run in the isolated startup-smoke compose service, with real DB/Redis available.
async function fails(label, overrides, expected) {
  const child = spawn(process.execPath, ['backend/dist/main.js'], {
    env: { ...process.env, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  // Allow the 60-second bootstrap guard plus module loading on Windows bind mounts.
  const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, `${label}: process hung`);
    assert.equal(code, 1, `${label}: must exit with failure`);
    assert.match(logs, /Starting API\.\.\./);
    assert.match(logs, expected);
    assert.doesNotMatch(logs, /Listening on|do-not-log-this/);
    console.log(`${label}: PASS (exit 1, bounded startup, sanitized logs)`);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

await fails(
  'production validation',
  { JWT_ACCESS_SECRET: 'do-not-log-this' },
  /JWT_ACCESS_SECRET must contain/,
);
await fails(
  'database unavailable',
  { DATABASE_URL: 'postgresql://smoke:do-not-log-this@127.0.0.1:1/smoke' },
  /Database startup connection or readiness failed/,
);
await fails(
  'Redis unavailable',
  { REDIS_URL: 'redis://:do-not-log-this@127.0.0.1:1' },
  /Redis is required but unavailable/,
);

const sockets = new Set();
const silentRedis = createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
silentRedis.listen(0, '127.0.0.1');
await once(silentRedis, 'listening');
try {
  await fails(
    'Redis accepts TCP but never responds',
    {
      REDIS_URL: `redis://127.0.0.1:${silentRedis.address().port}`,
    },
    /Redis is required but unavailable/,
  );
} finally {
  for (const socket of sockets) socket.destroy();
  silentRedis.close();
}
