import type { ShippingFeePaymentStatus } from './shipping-fee-payment-api';

export function clientRequestIdForPaymentAttempt(
  currentRequestId: string,
  latestStatus: ShippingFeePaymentStatus | null,
): string {
  return latestStatus === 'FAILED' ? crypto.randomUUID() : currentRequestId;
}
