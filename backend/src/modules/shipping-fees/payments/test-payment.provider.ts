import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  InvalidPaymentWebhookError,
  type CreateProviderPaymentInput,
  type CreatedProviderPayment,
  type ShippingFeePaymentProvider,
  type VerifiedPaymentWebhook,
} from './payment-provider.js';

interface TestWebhookBody {
  eventId: string;
  reference: string;
  providerReference: string;
  amount: number;
  status: 'SUCCEEDED' | 'FAILED';
  occurredAt: string;
  failureCode?: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,100}$/;
const SAFE_FAILURE_CODE = /^[A-Z0-9_]{1,100}$/;

export class TestPaymentProvider implements ShippingFeePaymentProvider {
  readonly code = 'TEST';
  readonly enabled = true;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.secret = config.getOrThrow<string>('PAYMENT_TEST_WEBHOOK_SECRET');
  }

  createPayment(input: CreateProviderPaymentInput): Promise<CreatedProviderPayment> {
    if (input.signal.aborted) return Promise.reject(new Error('Payment request aborted'));
    const checkoutUrl = new URL(input.returnUrl);
    checkoutUrl.searchParams.set('reference', input.reference);
    return Promise.resolve({
      providerReference: `TEST-${input.reference}`,
      checkoutUrl: checkoutUrl.toString(),
    });
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedPaymentWebhook {
    const signatureHeader = headers['x-payment-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) {
      throw new InvalidPaymentWebhookError('Payment signature is missing or malformed');
    }
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new InvalidPaymentWebhookError('Payment signature does not match');
    }

    let value: unknown;
    try {
      value = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new InvalidPaymentWebhookError('Payment webhook body is not valid JSON');
    }
    const body = this.parseBody(value);
    return {
      eventId: body.eventId,
      reference: body.reference,
      providerReference: body.providerReference,
      amount: body.amount,
      status: body.status,
      occurredAt: new Date(body.occurredAt),
      failureCode: body.status === 'FAILED' ? (body.failureCode ?? 'PAYMENT_FAILED') : null,
    };
  }

  private parseBody(value: unknown): TestWebhookBody {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new InvalidPaymentWebhookError();
    }
    const body = value as Record<string, unknown>;
    const keys = Object.keys(body);
    const allowed = new Set([
      'eventId',
      'reference',
      'providerReference',
      'amount',
      'status',
      'occurredAt',
      'failureCode',
    ]);
    if (keys.some((key) => !allowed.has(key))) throw new InvalidPaymentWebhookError();
    if (
      typeof body.eventId !== 'string' ||
      !SAFE_IDENTIFIER.test(body.eventId) ||
      typeof body.reference !== 'string' ||
      !SAFE_IDENTIFIER.test(body.reference) ||
      typeof body.providerReference !== 'string' ||
      !SAFE_IDENTIFIER.test(body.providerReference) ||
      !Number.isSafeInteger(body.amount) ||
      Number(body.amount) <= 0 ||
      (body.status !== 'SUCCEEDED' && body.status !== 'FAILED') ||
      typeof body.occurredAt !== 'string'
    ) {
      throw new InvalidPaymentWebhookError();
    }
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new InvalidPaymentWebhookError();
    if (
      body.failureCode !== undefined &&
      (typeof body.failureCode !== 'string' || !SAFE_FAILURE_CODE.test(body.failureCode))
    ) {
      throw new InvalidPaymentWebhookError();
    }
    if (body.status === 'SUCCEEDED' && body.failureCode !== undefined) {
      throw new InvalidPaymentWebhookError();
    }
    return body as unknown as TestWebhookBody;
  }
}
