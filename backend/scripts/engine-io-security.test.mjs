import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';

// GHSA-2gc4-cqfq-p2gv: an upgrade must retain the polling session's EIO revision.
// This standalone server uses the runtime defaults: polling + WebSocket, upgrades on.
test('Engine.IO rejects mismatched/omitted upgrade revision and still upgrades normal clients',
  { timeout: 15_000 }, async (context) => {
    const http = createServer((req, res) => {
      if (req.url === '/health') res.writeHead(200).end('alive');
      else res.writeHead(404).end();
    });
    const sockets = new Server(http);
    context.after(() => new Promise((resolve) => sockets.close(resolve)));
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const handshake = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`,
      { signal: AbortSignal.timeout(3_000) });
    assert.equal(handshake.status, 200);
    const packet = await handshake.text();
    assert.equal(packet[0], '0');
    const session = JSON.parse(packet.slice(1));
    assert.equal(typeof session.sid, 'string');
    assert.ok(session.upgrades.includes('websocket'));

    for (const revision of ['3', null]) {
      const url = new URL('/socket.io/', origin);
      if (revision) url.searchParams.set('EIO', revision);
      url.searchParams.set('transport', 'websocket');
      url.searchParams.set('sid', session.sid);
      assert.equal(await rejectedUpgradeStatus(url), 400);
      const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3_000) });
      assert.equal(health.status, 200);
      assert.equal(await health.text(), 'alive');
    }

    // The same EIO=4 session is still usable after both rejected attacks.
    const upgraded = new WebSocket(
      `${origin.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket&sid=${session.sid}`,
    );
    context.after(() => upgraded.close());
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native WebSocket upgrade timed out')), 3_000);
      upgraded.addEventListener('open', () => upgraded.send('2probe'), { once: true });
      upgraded.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Native WebSocket upgrade failed'));
      }, { once: true });
      upgraded.addEventListener('message', (event) => {
        if (event.data !== '3probe') return;
        upgraded.send('5');
        clearTimeout(timeout);
        resolve();
      });
    });
    upgraded.send('1');
    upgraded.close();

    const client = io(origin, {
      transports: ['polling', 'websocket'], upgrade: true, reconnection: false, timeout: 3_000,
    });
    context.after(() => client.disconnect());
    await Promise.all([
      new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      }),
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket.IO upgrade timed out')), 3_000);
        client.io.engine.once('upgrade', (transport) => {
          clearTimeout(timeout);
          assert.equal(transport.name, 'websocket');
          resolve();
        });
      }),
    ]);
    assert.equal(client.connected, true);
    assert.equal(client.io.engine.transport.name, 'websocket');
  });

function rejectedUpgradeStatus(url) {
  return new Promise((resolve, reject) => {
    const attempt = request(url, {
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    });
    attempt.setTimeout(3_000, () => attempt.destroy(new Error('Malformed upgrade timed out')));
    attempt.on('error', reject);
    attempt.on('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new Error('Mismatched Engine.IO upgrade was accepted'));
    });
    attempt.on('response', (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    });
    attempt.end();
  });
}
