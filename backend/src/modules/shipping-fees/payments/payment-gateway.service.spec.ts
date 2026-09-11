import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { ShippingFeePayer } from '../../../generated/prisma/client.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import {
  PaymentProviderUnavailableError,
  type CreateProviderPaymentInput,
  type ShippingFeePaymentProvider,
} from './payment-provider.js';

describe('PaymentGatewayService', () => {
  it('bounds provider calls and preserves the caller idempotency key on timeout', async () => {
    const createPayment = jest.fn(
      (input: CreateProviderPaymentInput) =>
        new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () =>
              reject(
                input.signal.reason instanceof Error
                  ? input.signal.reason
                  : new Error('Payment request aborted'),
              ),
            { once: true },
          );
        }),
    );
    const provider: ShippingFeePaymentProvider = {
      code: 'TEST',
      enabled: true,
      createPayment,
      verifyWebhook: jest.fn() as ShippingFeePaymentProvider['verifyWebhook'],
    };
    const gateway = new PaymentGatewayService(
      provider,
      new ConfigService({ PAYMENT_TIMEOUT_MS: 5 }),
    );

    await expect(
      gateway.createPayment({
        reference: 'SFP-TIMEOUT-1',
        amount: 35_000,
        payer: ShippingFeePayer.SENDER,
        returnUrl: 'http://localhost:5173/payments/result',
        idempotencyKey: 'SFP-TIMEOUT-1',
      }),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createPayment.mock.calls[0]?.[0]).toMatchObject({
      reference: 'SFP-TIMEOUT-1',
      idempotencyKey: 'SFP-TIMEOUT-1',
    });
  });
});
