import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { ShipmentStatus } from '../shipments/shipment-types';
import type {
  InboundQueue,
  Warehouse,
  WarehouseCatalogueItem,
  WarehouseShipment,
  PaginatedWarehouseExceptions,
  WarehouseStaffProfile,
  WarehouseTransfer,
} from './warehouse-types';

export interface Paginated<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function listWarehouses<T extends WarehouseCatalogueItem = Warehouse>(params?: {
  city?: string;
  ward?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<T>> {
  const response = await api.get<ApiEnvelope<Paginated<T>>>('/warehouses', {
    params: { page: 1, limit: 50, ...params },
  });
  return response.data.data;
}

export async function getWarehouse<T extends WarehouseCatalogueItem = Warehouse>(
  id: string,
): Promise<T> {
  const response = await api.get<ApiEnvelope<T>>(`/warehouses/${id}`);
  return response.data.data;
}

export async function createWarehouse(input: {
  code: string;
  name: string;
  address: string;
  ward?: string;
  district?: string;
  city: string;
  latitude?: number;
  longitude?: number;
}): Promise<Warehouse> {
  const response = await api.post<ApiEnvelope<Warehouse>>('/warehouses', input);
  return response.data.data;
}

export async function updateWarehouse(
  id: string,
  input: {
    name?: string;
    address?: string;
    ward?: string;
    district?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    isActive?: boolean;
  },
): Promise<Warehouse> {
  const response = await api.patch<ApiEnvelope<Warehouse>>(`/warehouses/${id}`, input);
  return response.data.data;
}

export async function toggleWarehouseStatus(id: string): Promise<Warehouse> {
  const response = await api.patch<ApiEnvelope<Warehouse>>(`/warehouses/${id}/status`);
  return response.data.data;
}

export async function getMyStaffProfile(): Promise<WarehouseStaffProfile> {
  const response = await api.get<ApiEnvelope<WarehouseStaffProfile>>('/warehouses/staff/me');
  return response.data.data;
}

export async function listWarehouseStaff(warehouseId: string): Promise<WarehouseStaffProfile[]> {
  const response = await api.get<ApiEnvelope<WarehouseStaffProfile[]>>(
    `/warehouses/${warehouseId}/staff`,
  );
  return response.data.data;
}

export async function assignWarehouseStaff(
  warehouseId: string,
  input: { userId: string; staffCode: string },
): Promise<WarehouseStaffProfile> {
  const response = await api.post<ApiEnvelope<WarehouseStaffProfile>>(
    `/warehouses/${warehouseId}/staff`,
    input,
  );
  return response.data.data;
}

export async function toggleStaffStatus(profileId: string): Promise<WarehouseStaffProfile> {
  const response = await api.patch<ApiEnvelope<WarehouseStaffProfile>>(
    `/warehouses/staff/${profileId}/status`,
  );
  return response.data.data;
}

export async function checkInShipment(
  warehouseId: string,
  input: {
    trackingCode?: string;
    shipmentId?: string;
    packageVerified: true;
    actualWeightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    note?: string;
  },
): Promise<{ idempotent: boolean; shipment: WarehouseShipment }> {
  const response = await api.post<
    ApiEnvelope<{ idempotent: boolean; shipment: WarehouseShipment }>
  >(`/warehouses/${warehouseId}/check-in`, input);
  return response.data.data;
}

export async function lookupCheckInShipment(
  warehouseId: string,
  trackingCode: string,
): Promise<WarehouseShipment> {
  const response = await api.get<ApiEnvelope<WarehouseShipment>>(
    `/warehouses/${warehouseId}/check-in/lookup`,
    { params: { trackingCode } },
  );
  return response.data.data;
}

export async function routeDestination(
  warehouseId: string,
  shipmentId: string,
  destinationWarehouseId: string,
): Promise<WarehouseShipment> {
  const response = await api.post<ApiEnvelope<WarehouseShipment>>(
    `/warehouses/${warehouseId}/shipments/${shipmentId}/route-destination`,
    { destinationWarehouseId },
  );
  return response.data.data;
}

export async function markReadyForDelivery(
  warehouseId: string,
  shipmentId: string,
): Promise<WarehouseShipment> {
  const response = await api.post<ApiEnvelope<WarehouseShipment>>(
    `/warehouses/${warehouseId}/shipments/${shipmentId}/ready-for-delivery`,
  );
  return response.data.data;
}

export async function createTransfer(
  warehouseId: string,
  input: {
    shipmentId: string;
    toWarehouseId: string;
    note?: string;
    clientRequestId: string;
  },
): Promise<WarehouseTransfer> {
  const response = await api.post<ApiEnvelope<WarehouseTransfer>>(
    `/warehouses/${warehouseId}/transfers`,
    input,
  );
  return response.data.data;
}

export async function dispatchTransfer(
  warehouseId: string,
  transferId: string,
): Promise<WarehouseTransfer> {
  const response = await api.post<ApiEnvelope<WarehouseTransfer>>(
    `/warehouses/${warehouseId}/transfers/${transferId}/dispatch`,
  );
  return response.data.data;
}

export async function receiveTransfer(
  warehouseId: string,
  transferId: string,
  input?: { note?: string; actualWeightGrams?: number },
): Promise<WarehouseTransfer> {
  const response = await api.post<ApiEnvelope<WarehouseTransfer>>(
    `/warehouses/${warehouseId}/transfers/${transferId}/receive`,
    input || {},
  );
  return response.data.data;
}

export async function listTransfers(
  warehouseId: string,
  direction?: 'inbound' | 'outbound' | 'all',
): Promise<WarehouseTransfer[]> {
  const response = await api.get<ApiEnvelope<WarehouseTransfer[]>>(
    `/warehouses/${warehouseId}/transfers`,
    { params: { direction } },
  );
  return response.data.data;
}

export async function listWarehouseShipments(
  warehouseId: string,
  params?: {
    status?: ShipmentStatus;
    search?: string;
    page?: number;
    limit?: number;
  },
): Promise<Paginated<WarehouseShipment>> {
  const response = await api.get<ApiEnvelope<Paginated<WarehouseShipment>>>(
    `/warehouses/${warehouseId}/shipments`,
    { params: { page: 1, limit: 50, ...params } },
  );
  return response.data.data;
}

export async function listInboundQueue(warehouseId: string): Promise<InboundQueue> {
  const response = await api.get<ApiEnvelope<InboundQueue>>(
    `/warehouses/${warehouseId}/inbound-queue`,
  );
  return response.data.data;
}

export async function listWarehouseExceptions(
  warehouseId: string,
  params?: {
    status?: 'DAMAGED' | 'LOST';
    search?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  },
): Promise<PaginatedWarehouseExceptions> {
  const response = await api.get<ApiEnvelope<PaginatedWarehouseExceptions>>(
    `/warehouses/${warehouseId}/exceptions`,
    { params: { page: 1, limit: 20, ...params } },
  );
  return response.data.data;
}
