import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvalidPaymentWebhookError,
  PaymentProviderUnavailableError,
  SHIPPING_FEE_PAYMENT_PROVIDER,
  type CreateProviderPaymentInput,
  type CreatedProviderPayment,
  type ShippingFeePaymentProvider,
  type VerifiedPaymentWebhook,
} from './payment-provider.js';

const SAFE_PROVIDER_VALUE = /^[A-Za-z0-9._:-]{1,100}$/;

@Injectable()
export class PaymentGatewayService {
  private readonly timeoutMs: number;

  constructor(
    @Inject(SHIPPING_FEE_PAYMENT_PROVIDER)
    private readonly provider: ShippingFeePaymentProvider,
    config: ConfigService,
  ) {
    this.timeoutMs = config.getOrThrow<number>('PAYMENT_TIMEOUT_MS');
  }

  get enabled(): boolean {
    return this.provider.enabled;
  }

  get providerCode(): string {
    return this.provider.code;
  }

  async createPayment(
    input: Omit<CreateProviderPaymentInput, 'signal'>,
  ): Promise<CreatedProviderPayment> {
    if (!this.provider.enabled) throw new PaymentProviderUnavailableError();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new PaymentProviderUnavailableError()),
      this.timeoutMs,
    );
    try {
      const result = await this.provider.createPayment({ ...input, signal: controller.signal });
      if (!SAFE_PROVIDER_VALUE.test(result.providerReference)) {
        throw new PaymentProviderUnavailableError();
      }
      const checkoutUrl = new URL(result.checkoutUrl);
      if (checkoutUrl.protocol !== 'https:' && checkoutUrl.protocol !== 'http:') {
        throw new PaymentProviderUnavailableError();
      }
      return { providerReference: result.providerReference, checkoutUrl: checkoutUrl.toString() };
    } catch {
      throw new PaymentProviderUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedPaymentWebhook {
    if (!this.provider.enabled) throw new InvalidPaymentWebhookError();
    return this.provider.verifyWebhook(rawBody, headers);
  }
}
