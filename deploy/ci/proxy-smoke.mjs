import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { verifyReleasePair } from '../../backend/src/common/release/release-build.ts';

// Fixed disposable container origin. TLS certificate is trusted via NODE_EXTRA_CA_CERTS.
const origin = 'https://localhost:18443';
const request = (path, options) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
const ready = await request('/api/v1/health/ready');
assert.equal(ready.status, 200);
assert.equal((await ready.json()).data.status, 'ok');
const versionResponse = await request('/api/v1/health/version');
assert.equal(versionResponse.status, 200);
const { data: backendRelease } = await versionResponse.json();
assert.deepEqual(Object.keys(backendRelease).sort(), ['buildTimestamp', 'commitSha', 'runtimeNodeVersion']);
assert.match(backendRelease.runtimeNodeVersion, /^v22\./);
const frontendReleaseResponse = await request('/release.json');
assert.equal(frontendReleaseResponse.status, 200);
const frontendRelease = await frontendReleaseResponse.json();
assert.deepEqual(Object.keys(frontendRelease).sort(), ['buildTimestamp', 'commitSha']);
assert.equal(backendRelease.commitSha, frontendRelease.commitSha, 'live backend/frontend SHA match');
assert.equal(backendRelease.buildTimestamp, frontendRelease.buildTimestamp, 'container builds retain the supplied build timestamp');
assert.ok(Number.isFinite(Date.parse(backendRelease.buildTimestamp)));
verifyReleasePair(backendRelease, frontendRelease, process.env);
const html = await request('/login');
assert.equal(html.status, 200);
assert.match(html.headers.get('cache-control'), /no-cache/);
const body = await html.text();
assert.match(body, /<div id="root">/);
const asset = body.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
assert.ok(asset, 'Production JS asset exists');
const js = await request(asset);
assert.match(js.headers.get('cache-control'), /immutable/);
assert.doesNotMatch(await js.text(), /localhost:3000|phase-h3-browser-test-webhook-secret/);
assert.equal((await request('/api/v1/users')).status, 401);
assert.equal((await request('/api/docs')).status, 404);

const register = await request('/api/v1/auth/register', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ email: `i2-${randomUUID()}@example.test`, fullName: 'I2 Release Smoke', password: randomBytes(24).toString('hex') }),
});
assert.equal(register.status, 201);
const cookie = register.headers.get('set-cookie');
assert.match(cookie, /^__Secure-logistics_refresh=/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /; Secure/);
const { data } = await register.json();
const socket = io(`${origin}/operations`, { transports: ['websocket'], auth: { token: data.accessToken }, autoConnect: false });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('TLS proxy Socket connect timeout')), 10000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
    socket.connect();
  });
  assert.equal((await request('/api/v1/auth/logout', {
    method: 'POST', headers: { origin, cookie: cookie.split(';')[0] },
  })).status, 200);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Revoked socket did not disconnect')), 10000);
    socket.once('disconnect', () => { clearTimeout(timeout); resolve(); });
    socket.emit('shipment.subscribe', { shipmentId: randomUUID() });
  });
} finally { socket.disconnect(); }
console.log('PASS HTTPS frontend/SPA/cache, API readiness/auth/secure cookie, WebSocket upgrade and revoked session through two proxies');
