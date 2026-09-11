import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ShippingFeePayer } from '../../../generated/prisma/client.js';
import { InvalidPaymentWebhookError } from './payment-provider.js';
import { TestPaymentProvider } from './test-payment.provider.js';

describe('TestPaymentProvider', () => {
  const secret = 'phase-h3-unit-test-webhook-secret-32-characters';
  const provider = new TestPaymentProvider(
    new ConfigService({ PAYMENT_TEST_WEBHOOK_SECRET: secret }),
  );

  it('creates a deterministic test checkout without exposing a provider secret', async () => {
    const result = await provider.createPayment({
      reference: 'SFP-TEST-1',
      amount: 35_000,
      payer: ShippingFeePayer.SENDER,
      returnUrl: 'http://localhost:5173/payments/result',
      idempotencyKey: 'SFP-TEST-1',
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      providerReference: 'TEST-SFP-TEST-1',
      checkoutUrl: 'http://localhost:5173/payments/result?reference=SFP-TEST-1',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('verifies the raw-body HMAC and normalizes a successful webhook', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        eventId: 'evt-1',
        reference: 'SFP-TEST-1',
        providerReference: 'TEST-SFP-TEST-1',
        amount: 35_000,
        status: 'SUCCEEDED',
        occurredAt: '2026-09-07T12:00:00.000Z',
      }),
    );
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(provider.verifyWebhook(rawBody, { 'x-payment-signature': signature })).toEqual({
      eventId: 'evt-1',
      reference: 'SFP-TEST-1',
      providerReference: 'TEST-SFP-TEST-1',
      amount: 35_000,
      status: 'SUCCEEDED',
      occurredAt: new Date('2026-09-07T12:00:00.000Z'),
      failureCode: null,
    });
  });

  it('rejects an invalid signature before parsing the payload', () => {
    const rawBody = Buffer.from('{"not":"trusted"}');
    expect(() =>
      provider.verifyWebhook(rawBody, { 'x-payment-signature': '0'.repeat(64) }),
    ).toThrow(InvalidPaymentWebhookError);
  });
});
