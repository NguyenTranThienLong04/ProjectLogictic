import assert from 'node:assert/strict';
import test from 'node:test';
import viteConfig from '../vite.config.ts';

test('development same-origin API and Socket.IO fallbacks proxy to the configured backend port', () => {
  const previousPort = process.env.PORT;
  process.env.PORT = '3100';

  try {
    const config = viteConfig({ command: 'serve', mode: 'development' });

    assert.equal(config.server?.proxy?.['/api']?.target, 'http://localhost:3100');
    assert.equal(config.server?.proxy?.['/socket.io']?.target, 'http://localhost:3100');
    assert.equal(config.server?.proxy?.['/socket.io']?.ws, true);
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
});

test('production config does not include the development API proxy', () => {
  const config = viteConfig({ command: 'build', mode: 'production' });

  assert.equal(config.server?.proxy, undefined);
});

test('production rejects IPv6 and alternate loopback API URLs', () => {
  const previous = process.env.VITE_API_URL;
  try {
    for (const url of ['https://[::1]/api/v1', 'https://127.1.2.3/api/v1', 'https://app.localhost/api/v1']) {
      process.env.VITE_API_URL = url;
      assert.throws(() => viteConfig({ command: 'build', mode: 'production' }), /localhost/);
    }
  } finally {
    if (previous === undefined) delete process.env.VITE_API_URL;
    else process.env.VITE_API_URL = previous;
  }
});
