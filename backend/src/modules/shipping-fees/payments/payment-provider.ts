import type { ShippingFeePayer } from '../../../generated/prisma/client.js';

export const SHIPPING_FEE_PAYMENT_PROVIDER = Symbol('SHIPPING_FEE_PAYMENT_PROVIDER');

export interface CreateProviderPaymentInput {
  reference: string;
  amount: number;
  payer: ShippingFeePayer;
  returnUrl: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface CreatedProviderPayment {
  providerReference: string;
  checkoutUrl: string;
}

export interface VerifiedPaymentWebhook {
  eventId: string;
  reference: string;
  providerReference: string;
  amount: number;
  status: 'SUCCEEDED' | 'FAILED';
  occurredAt: Date;
  failureCode: string | null;
}

export interface ShippingFeePaymentProvider {
  readonly code: string;
  readonly enabled: boolean;
  createPayment(input: CreateProviderPaymentInput): Promise<CreatedProviderPayment>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedPaymentWebhook;
}

export class PaymentProviderUnavailableError extends Error {
  constructor() {
    super('The configured payment provider is unavailable');
    this.name = 'PaymentProviderUnavailableError';
  }
}

export class InvalidPaymentWebhookError extends Error {
  constructor(message = 'The payment webhook is invalid') {
    super(message);
    this.name = 'InvalidPaymentWebhookError';
  }
}
