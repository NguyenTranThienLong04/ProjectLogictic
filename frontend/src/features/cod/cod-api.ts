import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
export type CodStatus = 'PENDING' | 'COLLECTED' | 'REMITTED' | 'SETTLED' | 'DISPUTED';
export interface CodTransaction {
  id: string;
  shipmentId: string;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  status: CodStatus;
  shipment: { trackingCode: string };
  collectedByDriver: { user: { fullName: string } } | null;
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
export async function remitCod(input: { shipmentId: string; amount: number }) {
  return (await api.post<ApiEnvelope<Omit<CodTransaction, 'shipment' | 'collectedByDriver'>>>(
    `/cod/shipments/${input.shipmentId}/remit`, { amount: input.amount },
  )).data.data;
}
export async function settleCod(id: string) {
  return (await api.post<ApiEnvelope<Omit<CodTransaction, 'shipment' | 'collectedByDriver'>>>(`/cod/${id}/settle`)).data.data;
}
