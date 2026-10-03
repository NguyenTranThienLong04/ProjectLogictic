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

test('build embeds the same public identity in JS and the independent release.json artifact', () => {
  const keys = ['RELEASE_SHA', 'RENDER_GIT_COMMIT', 'GITHUB_SHA', 'RELEASE_BUILD_TIMESTAMP'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const release = { commitSha: 'a'.repeat(40), buildTimestamp: '2026-10-03T01:00:00.000Z' };
  try {
    for (const key of keys) delete process.env[key];
    process.env.RENDER_GIT_COMMIT = release.commitSha;
    process.env.RELEASE_BUILD_TIMESTAMP = release.buildTimestamp;
    const config = viteConfig({ command: 'build', mode: 'production' });
    assert.deepEqual(JSON.parse(config.define.__RELEASE_PROVENANCE__), release);
    const plugin = config.plugins.flat().find((candidate) => candidate?.name === 'release-provenance');
    const assets = [];
    plugin.generateBundle.call({ emitFile: (asset) => assets.push(asset) });
    assert.equal(assets[0].fileName, 'release.json');
    assert.deepEqual(JSON.parse(assets[0].source), release);
    assert.deepEqual(Object.keys(release).sort(), ['buildTimestamp', 'commitSha']);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
