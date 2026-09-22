import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { updateAuthSession } from '../src/services/auth-session.ts';
import { subscribeWithAuthQueryCache } from '../src/services/auth-query-cache.ts';

const session = (id, accessToken = 'test-token', role = 'WAREHOUSE_STAFF') => ({
  accessToken,
  user: { id, role },
});

test('account switch clears warehouse data and cancels old requests before publishing new identity', async () => {
  updateAuthSession(session('origin-staff'));
  const client = new QueryClient();
  client.setQueryData(['warehouse-staff-profile'], { warehouseId: 'origin' });
  let aborted = false;
  const pending = client
    .fetchQuery({
      queryKey: ['warehouse-inventory'],
      queryFn: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve(['old-private-data']);
          });
        }),
    })
    .catch(() => undefined);
  client.getMutationCache().build(client, { mutationKey: ['check-in'] });
  const unsubscribe = subscribeWithAuthQueryCache(client, (next) => {
    assert.equal(next.user.id, 'destination-staff');
    assert.equal(client.getQueryData(['warehouse-staff-profile']), undefined);
    assert.equal(client.getMutationCache().getAll().length, 0);
  });
  try {
    updateAuthSession(session('destination-staff'));
    await pending;
    assert.equal(aborted, true);
    assert.equal(client.getQueryData(['warehouse-inventory']), undefined);
  } finally {
    unsubscribe();
    client.clear();
    updateAuthSession(null);
  }
});

test('token rotation keeps same-account data; logout and role change clear it', () => {
  updateAuthSession(session('staff'));
  const client = new QueryClient();
  const unsubscribe = subscribeWithAuthQueryCache(client, () => {});
  try {
    client.setQueryData(['private'], 'current');
    updateAuthSession(session('staff', 'rotated'));
    assert.equal(client.getQueryData(['private']), 'current');
    updateAuthSession(session('staff', 'rotated', 'ADMIN'));
    assert.equal(client.getQueryData(['private']), undefined);
    client.setQueryData(['private'], 'admin');
    updateAuthSession(null);
    assert.equal(client.getQueryData(['private']), undefined);
  } finally {
    unsubscribe();
    client.clear();
    updateAuthSession(null);
  }
});
