import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { ShippingFeePayer, ShippingFeeTransactionStatus } from '../shipments/shipment-types';

export interface ShippingFeeActor {
  employeeCode: string;
  user: { fullName: string; email: string };
}

export interface ShippingFeeDispute {
  id?: string;
  reason: string;
  openedAt: string;
  fromStatus?: 'COLLECTED' | 'REMITTED';
}

export interface ShippingFeeLedgerItem {
  id: string;
  payer: ShippingFeePayer;
  payerName?: string | null;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  paidAmount: number | null;
  status: ShippingFeeTransactionStatus;
  collectedAt: string | null;
  remittedAt: string | null;
  settledAt: string | null;
  paidAt: string | null;
  createdAt: string;
  shipment: { id: string; trackingCode: string };
  collector?: ShippingFeeActor | null;
  remitter?: ShippingFeeActor | null;
  settler?: { fullName: string; email: string } | null;
  currentDispute: ShippingFeeDispute | null;
  availableActions: {
    remit?: boolean;
    settle?: boolean;
    dispute?: boolean;
    resolve?: boolean;
  };
}

export interface ShippingFeeSummary {
  status: ShippingFeeTransactionStatus;
  totalAmount: number;
  count: number;
}

export interface ShippingFeeLedger {
  items: ShippingFeeLedgerItem[];
  summary: ShippingFeeSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ShippingFeeFilters {
  status?: ShippingFeeTransactionStatus;
  payer?: ShippingFeePayer;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listMyShippingFees(params: ShippingFeeFilters): Promise<ShippingFeeLedger> {
  const response = await api.get<ApiEnvelope<ShippingFeeLedger>>('/shipping-fees/mine', {
    params,
  });
  return response.data.data;
}

export async function listShippingFeeReconciliation(
  params: ShippingFeeFilters,
): Promise<ShippingFeeLedger> {
  const response = await api.get<ApiEnvelope<ShippingFeeLedger>>('/shipping-fees/reconciliation', {
    params,
  });
  return response.data.data;
}

export async function remitShippingFee(input: { id: string; amount: number }) {
  const response = await api.post<ApiEnvelope<ShippingFeeLedgerItem>>(
    `/shipping-fees/${input.id}/remit`,
    { amount: input.amount },
  );
  return response.data.data;
}

export async function settleShippingFee(id: string) {
  const response = await api.post<ApiEnvelope<ShippingFeeLedgerItem>>(
    `/shipping-fees/${id}/settle`,
  );
  return response.data.data;
}

export async function disputeShippingFee(input: { id: string; reason: string }) {
  const response = await api.post<ApiEnvelope<ShippingFeeLedgerItem>>(
    `/shipping-fees/${input.id}/dispute`,
    { reason: input.reason },
  );
  return response.data.data;
}

export async function resolveShippingFeeDispute(input: { id: string; resolutionNote: string }) {
  const response = await api.post<ApiEnvelope<ShippingFeeLedgerItem>>(
    `/shipping-fees/${input.id}/resolve`,
    { resolutionNote: input.resolutionNote },
  );
  return response.data.data;
}
