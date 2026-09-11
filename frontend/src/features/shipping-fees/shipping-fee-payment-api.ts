import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { ShippingFeePayer, ShippingFeeTransactionStatus } from '../shipments/shipment-types';

export type ShippingFeePaymentStatus = 'CREATING' | 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface ShippingFeePaymentResult {
  reference: string;
  amount: number;
  payer: ShippingFeePayer;
  status: ShippingFeePaymentStatus;
  feeStatus: ShippingFeeTransactionStatus;
  initiatedAt: string;
  succeededAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  checkoutUrl: string | null;
  shipment: { id: string; trackingCode: string };
}

export interface ShippingFeePaymentOverview {
  availableActions: { createPayment: boolean };
  unavailableReason: string | null;
  payment: ShippingFeePaymentResult | null;
}

export async function getShippingFeePaymentOverview(
  shipmentId: string,
): Promise<ShippingFeePaymentOverview> {
  const response = await api.get<ApiEnvelope<ShippingFeePaymentOverview>>(
    `/shipping-fee-payments/shipments/${shipmentId}`,
  );
  return response.data.data;
}

export async function createShippingFeePayment(input: {
  shipmentId: string;
  clientRequestId: string;
}): Promise<ShippingFeePaymentResult> {
  const response = await api.post<ApiEnvelope<ShippingFeePaymentResult>>(
    '/shipping-fee-payments',
    input,
  );
  return response.data.data;
}

export async function getShippingFeePaymentResult(
  reference: string,
): Promise<ShippingFeePaymentResult> {
  const response = await api.get<ApiEnvelope<ShippingFeePaymentResult>>(
    `/shipping-fee-payments/results/${encodeURIComponent(reference)}`,
  );
  return response.data.data;
}
