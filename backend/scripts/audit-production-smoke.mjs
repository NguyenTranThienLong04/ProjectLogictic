import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const database = new URL(process.env.AUDIT_DATABASE_URL ?? '');
const redis = new URL(process.env.AUDIT_REDIS_URL ?? '');
assert.equal(database.hostname, '127.0.0.1');
assert.ok(database.pathname.startsWith('/i1_'));
assert.equal(redis.hostname, '127.0.0.1');
assert.equal(redis.port, '56379');
const base = 'http://127.0.0.1:3101';
const origin = 'https://i1.example.test';
const password = randomBytes(24).toString('hex');
let logs = '';
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: {
    ...process.env, NODE_ENV: 'production', PORT: '3101',
    DATABASE_URL: database.toString(), REDIS_URL: redis.toString(),
    FRONTEND_URL: origin, PASSWORD_RESET_URL: `${origin}/reset-password`,
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    ROUTE_PROVIDER: 'DISABLED', ROUTE_PROVIDER_BASE_URL: '',
    PAYMENT_PROVIDER: 'DISABLED', PAYMENT_TEST_WEBHOOK_SECRET: '',
    EMAIL_DELIVERY_ENABLED: 'false', SWAGGER_ENABLED: 'false', TRUST_PROXY_HOPS: '0',
    REFRESH_COOKIE_NAME: '__Secure-logistics_refresh', REFRESH_COOKIE_SAME_SITE: 'lax',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
let socket;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Production process exited before readiness');
    try { ready = (await fetch(`${base}/api/v1/health/ready`)).ok; } catch { /* startup */ }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'production readiness');
  assert.equal((await fetch(`${base}/api/v1/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/api/docs`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/users`)).status, 401);
  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: `i1-${randomUUID()}@example.test`, fullName: 'I1 Audit', password }),
  });
  assert.equal(register.status, 201);
  assert.equal(register.headers.get('access-control-allow-origin'), origin);
  assert.equal(register.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(register.headers.get('x-request-id'));
  const setCookie = register.headers.get('set-cookie');
  assert.match(setCookie, /^__Secure-logistics_refresh=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /; Secure/i);
  const { data: auth } = await register.json();
  const authorization = `Bearer ${auth.accessToken}`;
  const cookie = setCookie.split(';')[0];
  assert.equal((await fetch(`${base}/api/v1/users`, { headers: { authorization } })).status, 403);
  const payment = await fetch(`${base}/api/v1/shipping-fee-payments`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: randomUUID(), clientRequestId: randomUUID() }),
  });
  assert.equal(payment.status, 503);
  const webhook = await fetch(`${base}/api/v1/shipping-fee-payments/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(webhook.status, 400);
  assert.equal((await fetch(`${base}/api/v1/auth/refresh`, {
    method: 'POST', headers: { cookie, origin: 'https://untrusted.example.test' },
  })).status, 403);
  socket = io(`${base}/operations`, { auth: { token: auth.accessToken }, transports: ['websocket'], autoConnect: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
  assert.equal((await fetch(`${base}/api/v1/auth/logout`, {
    method: 'POST', headers: { cookie, origin },
  })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/users/me`, { headers: { authorization } })).status, 401);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Revoked socket was not disconnected')), 5000);
    socket.once('disconnect', () => { clearTimeout(timer); resolve(); });
    socket.emit('shipment.subscribe', { shipmentId: randomUUID() });
  });
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${attempt}` },
      body: JSON.stringify({ email: 'missing-i1@example.test', password }),
    });
    if (attempt === 10) {
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get('retry-after')) <= 60);
    }
  }
  assert.ok(!logs.includes(password), 'logs must redact passwords');
  assert.ok(!logs.includes(auth.accessToken), 'logs must redact access tokens');
  console.log('PASS production artifact: disabled providers, live/ready, auth/RBAC, secure cookie, trusted origin, socket revocation, rate limit/proxy and log redaction.');
} finally {
  socket?.disconnect();
  child.kill();
  // Windows termination is process termination, not evidence of POSIX graceful SIGTERM handling.
}
