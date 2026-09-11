import { api, authApi } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type {
  AddressSnapshot,
  PackageSnapshot,
  PaginatedShipments,
  PublicTracking,
  Shipment,
  ShippingFeePayer,
  ShipmentStatus,
} from './shipment-types';

export interface CreateShipmentInput {
  clientRequestId: string;
  pickupAddressId: string;
  deliveryAddress: AddressSnapshot;
  package: PackageSnapshot;
  codAmount: number;
  shippingFeePayer: ShippingFeePayer;
}

export async function createShipment(input: CreateShipmentInput): Promise<Shipment> {
  const response = await api.post<ApiEnvelope<Shipment>>('/shipments', input);
  return response.data.data;
}

export async function listShipments(params: {
  page: number;
  status?: ShipmentStatus;
}): Promise<PaginatedShipments> {
  const response = await api.get<ApiEnvelope<PaginatedShipments>>('/shipments', {
    params: { page: params.page, limit: 10, status: params.status || undefined },
  });
  return response.data.data;
}

export async function getShipment(shipmentId: string): Promise<Shipment> {
  const response = await api.get<ApiEnvelope<Shipment>>(`/shipments/${shipmentId}`);
  return response.data.data;
}

export async function cancelShipment(shipmentId: string, reason: string): Promise<Shipment> {
  const response = await api.post<ApiEnvelope<Shipment>>(`/shipments/${shipmentId}/cancel`, {
    reason,
  });
  return response.data.data;
}

export async function getPublicTracking(trackingCode: string): Promise<PublicTracking> {
  const response = await authApi.get<ApiEnvelope<PublicTracking>>(
    `/tracking/${encodeURIComponent(trackingCode)}`,
  );
  return response.data.data;
}
