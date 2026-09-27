import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
export type CodStatus = 'PENDING' | 'COLLECTED' | 'REMITTED' | 'SETTLED' | 'DISPUTED';
export interface CodRemittance {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  amount: number;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  version: number;
}
export interface CodPayout {
  id: string;
  amount: number;
  method: 'BANK_TRANSFER' | 'CASH';
  reference: string | null;
  status: 'PENDING' | 'SENT' | 'PAID_OUT' | 'DISPUTED';
  version: number;
  createdAt: string;
  sentAt: string | null;
  customerConfirmedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
}
export interface CustomerCodDetail {
  status: CodStatus;
  expectedAmount: number;
  collectedAt: string | null;
  remittedAt: string | null;
  settledAt: string | null;
  remittances: Pick<CodRemittance, 'id' | 'status' | 'submittedAt' | 'reviewedAt'>[];
  payout: CodPayout | null;
}
export interface CodTransaction {
  id: string;
  shipmentId: string;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  status: CodStatus;
  shipment: { trackingCode: string; customer: { fullName: string } };
  collectedByDriver: { user: { fullName: string } } | null;
  remittances: CodRemittance[];
  payout?: CodPayout | null;
}
export interface CodDashboard {
  items: CodTransaction[];
  summary: Array<{
    status: CodStatus;
    _sum: { expectedAmount: number | null };
    _count: { _all: number };
  }>;
}
export async function getCodDashboard() {
  return (await api.get<ApiEnvelope<CodDashboard>>('/cod/dashboard')).data.data;
}
export async function getMyCod() {
  return (await api.get<ApiEnvelope<CodDashboard>>('/cod/mine')).data.data;
}
export async function remitCod(input: {
  shipmentId: string;
  amount: number;
  clientRequestId: string;
  note?: string;
}) {
  return (
    await api.post<ApiEnvelope<CodRemittance>>(`/cod/shipments/${input.shipmentId}/remit`, {
      amount: input.amount,
      clientRequestId: input.clientRequestId,
      note: input.note,
    })
  ).data.data;
}
export async function reviewRemittance(id: string, expectedVersion: number, reason?: string) {
  return (
    await api.post<ApiEnvelope<CodRemittance>>(
      `/cod/remittances/${id}/${reason === undefined ? 'confirm' : 'reject'}`,
      { expectedVersion, ...(reason === undefined ? {} : { reason }) },
    )
  ).data.data;
}
export async function createCodPayout(
  id: string,
  input: { amount: number; method: CodPayout['method']; reference: string; note?: string },
) {
  return (await api.post<ApiEnvelope<CodPayout>>(`/cod/${id}/payout`, input)).data.data;
}
export async function sendCodPayout(payout: CodPayout) {
  return (
    await api.post<ApiEnvelope<CodPayout>>(`/cod/payouts/${payout.id}/send`, {
      expectedVersion: payout.version,
      reference: payout.reference,
    })
  ).data.data;
}
export async function acknowledgeCodPayout(payout: CodPayout, reason?: string) {
  return (
    await api.post<ApiEnvelope<CodPayout>>(
      `/cod/payouts/${payout.id}/${reason === undefined ? 'confirm' : 'dispute'}`,
      { expectedVersion: payout.version, ...(reason === undefined ? {} : { reason }) },
    )
  ).data.data;
}
export async function getCustomerCod(shipmentId: string) {
  return (await api.get<ApiEnvelope<CustomerCodDetail | null>>(`/cod/shipments/${shipmentId}`)).data
    .data;
}
export async function settleCod(id: string) {
  return (
    await api.post<ApiEnvelope<Omit<CodTransaction, 'shipment' | 'collectedByDriver'>>>(
      `/cod/${id}/settle`,
    )
  ).data.data;
}
