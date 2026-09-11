import assert from 'node:assert/strict';
import test from 'node:test';

test('rotated sessions and logout reach other tabs without echo or persistent storage', async () => {
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const channels = [];
  let broadcasts = 0;
  globalThis.window = {};
  globalThis.BroadcastChannel = class {
    constructor() { channels.push(this); }
    postMessage(data) {
      broadcasts++;
      for (const channel of channels) {
        if (channel !== this) channel.onmessage?.({ data });
      }
    }
  };
  try {
    const first = await import('../src/services/auth-session.ts?tab=one');
    const second = await import('../src/services/auth-session.ts?tab=two');
    first.updateAuthSession({ accessToken: 'rotated-token', user: { id: 'customer-1' } });
    assert.equal(second.getAccessToken(), 'rotated-token');
    assert.equal(broadcasts, 1);
    second.updateAuthSession(null);
    assert.equal(first.getAuthSession(), null);
    assert.equal(broadcasts, 2);
  } finally {
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  }
});
