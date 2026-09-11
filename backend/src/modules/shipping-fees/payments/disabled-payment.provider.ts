import {
  InvalidPaymentWebhookError,
  PaymentProviderUnavailableError,
  type CreatedProviderPayment,
  type ShippingFeePaymentProvider,
  type VerifiedPaymentWebhook,
} from './payment-provider.js';

export class DisabledPaymentProvider implements ShippingFeePaymentProvider {
  readonly code = 'DISABLED';
  readonly enabled = false;

  createPayment(): Promise<CreatedProviderPayment> {
    return Promise.reject(new PaymentProviderUnavailableError());
  }

  verifyWebhook(): VerifiedPaymentWebhook {
    throw new InvalidPaymentWebhookError('Payment webhooks are disabled');
  }
}
