import assert from 'node:assert/strict';
import test from 'node:test';
import { clientRequestIdForPaymentAttempt } from '../src/features/shipping-fees/shipping-fee-payment-idempotency.ts';

test('payment retry preserves its request key until a provider failure is authoritative', () => {
  const current = '9b8f3511-f665-4ae8-b8f1-97fb25ac2b93';

  assert.equal(clientRequestIdForPaymentAttempt(current, null), current);
  assert.equal(clientRequestIdForPaymentAttempt(current, 'CREATING'), current);
  assert.equal(clientRequestIdForPaymentAttempt(current, 'PENDING'), current);
});

test('a failed payment rotates its request key so the next click creates a new attempt', () => {
  const current = '9b8f3511-f665-4ae8-b8f1-97fb25ac2b93';
  const next = clientRequestIdForPaymentAttempt(current, 'FAILED');

  assert.notEqual(next, current);
  assert.match(next, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
