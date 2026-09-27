import assert from 'node:assert/strict';
import test from 'node:test';
import { startDriverGpsPublisher } from '../src/features/locations/driver-gps-publisher.ts';

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100_000 });
  const sent = [],
    states = [];
  const stop = startDriverGpsPublisher({
    locate: async () => ({ latitude: 10, longitude: 106, timestamp: Date.now() }),
    publish: async (point, signal) => {
      sent.push({ point, signal, at: Date.now() });
    },
    onState: (state) => states.push(state),
    onPublishError: () => ({ message: 'Unavailable', stop: false }),
    ...overrides,
  });
  t.after(stop);
  return {
    stop,
    sent,
    states,
    advance: async (ms) => {
      t.mock.timers.tick(ms);
      await flush();
    },
  };
}

test('fresh stationary positions publish immediately then once each 5s; stop aborts and clears timer', async (t) => {
  const f = fixture(t);
  await flush();
  await f.advance(4_999);
  assert.equal(f.sent.length, 1);
  await f.advance(1);
  await f.advance(5_000);
  assert.deepEqual(
    f.sent.map((x) => x.at),
    [100_000, 105_000, 110_000],
  );
  f.stop();
  assert.ok(f.sent.every((x) => x.signal.aborted));
  await f.advance(30_000);
  assert.equal(f.sent.length, 3);
});
test('discarded StrictMode mount does not locate or publish', async (t) => {
  const f = fixture(t);
  f.stop();
  await flush();
  assert.equal(f.sent.length, 0);
});
test('stop fences a pending browser position callback', async (t) => {
  let resolve;
  const f = fixture(t, {
    locate: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await flush();
  f.stop();
  resolve({ latitude: 10, longitude: 106, timestamp: Date.now() });
  await flush();
  assert.equal(f.sent.length, 0);
});
test('denial is visible and stops subsequent permission requests', async (t) => {
  let calls = 0;
  const f = fixture(t, {
    locate: async () => {
      calls++;
      throw { code: 1 };
    },
  });
  await flush();
  await f.advance(30_000);
  assert.equal(calls, 1);
  assert.equal(f.states.at(-1), 'PERMISSION_DENIED');
  assert.equal(f.sent.length, 0);
});
test('20s old device sample is never relabelled and posted', async (t) => {
  const f = fixture(t, {
    locate: async () => ({ latitude: 10, longitude: 106, timestamp: Date.now() - 20_000 }),
  });
  await flush();
  assert.equal(f.sent.length, 0);
  assert.equal(f.states.at(-1), 'STALE');
});
test('slow requests never overlap and status expires while request is pending', async (t) => {
  let calls = 0;
  const f = fixture(t, {
    publish: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await flush();
  await f.advance(20_000);
  assert.equal(calls, 1);
  assert.equal(f.states.at(-1), 'STALE');
});
test('HTTP failure never reports current; recovery uses a fresh sample', async (t) => {
  let calls = 0;
  const f = fixture(t, {
    publish: async () => {
      if (++calls === 1) throw Error('network');
    },
  });
  await flush();
  assert.equal(f.states.at(-1), 'SERVICE_UNAVAILABLE');
  await f.advance(5_000);
  assert.equal(f.states.at(-1), 'CURRENT');
});
test('authorization rejection stops publishing until explicit lifecycle restart', async (t) => {
  let calls = 0;
  const f = fixture(t, {
    publish: async () => {
      calls++;
      throw Error('suspended');
    },
    onPublishError: () => ({ message: 'Suspended', stop: true }),
  });
  await flush();
  await f.advance(30_000);
  assert.equal(calls, 1);
  assert.equal(f.states.at(-1), 'DISABLED');
});
