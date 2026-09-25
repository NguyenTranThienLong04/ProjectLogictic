import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { ShipmentStatus } from '../shipments/shipment-types';
import type {
  Assignment,
  AssignmentCandidates,
  DeliveryAssignment,
  DeliveryFailureReason,
  DriverProfile,
  DriverCapability,
  DriverStatus,
  DriverDeliveryListView,
  OperationalShipment,
  OperationalShipmentView,
  Paginated,
} from './operations-types';

export async function listOperationalShipments(
  params: {
    view?: OperationalShipmentView;
    status?: ShipmentStatus;
    search?: string;
    fromDate?: string;
    toDate?: string;
    driverId?: string;
    warehouseId?: string;
    customerId?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<Paginated<OperationalShipment>> {
  const response = await api.get<ApiEnvelope<Paginated<OperationalShipment>>>(
    '/dispatcher/shipments',
    { params: { page: 1, limit: 20, ...params } },
  );
  return response.data.data;
}

export async function getOperationalShipment(shipmentId: string): Promise<OperationalShipment> {
  const response = await api.get<ApiEnvelope<OperationalShipment>>(
    `/dispatcher/shipments/${shipmentId}`,
  );
  return response.data.data;
}

export async function confirmShipment(shipmentId: string): Promise<OperationalShipment> {
  const response = await api.post<ApiEnvelope<OperationalShipment>>(
    `/dispatcher/shipments/${shipmentId}/confirm`,
  );
  return response.data.data;
}

export async function assignPickup(input: {
  shipmentId: string;
  driverId: string;
}): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/dispatcher/shipments/${input.shipmentId}/pickup-assignments`,
    { driverId: input.driverId, clientRequestId: crypto.randomUUID() },
  );
  return response.data.data;
}

export async function reassignPickup(input: {
  shipmentId: string;
  driverId: string;
  reason: string;
}): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/dispatcher/shipments/${input.shipmentId}/pickup-reassignments`,
    { driverId: input.driverId, reason: input.reason, clientRequestId: crypto.randomUUID() },
  );
  return response.data.data;
}

export async function listAvailableDrivers(): Promise<DriverProfile[]> {
  const response = await api.get<ApiEnvelope<DriverProfile[]>>('/drivers/available');
  return response.data.data;
}

export async function listPickupCandidates(shipmentId: string): Promise<AssignmentCandidates> {
  const response = await api.get<ApiEnvelope<AssignmentCandidates>>(
    `/dispatcher/shipments/${shipmentId}/pickup-candidates`,
  );
  return response.data.data;
}

export async function listDeliveryCandidates(shipmentId: string): Promise<AssignmentCandidates> {
  const response = await api.get<ApiEnvelope<AssignmentCandidates>>(
    `/dispatcher/shipments/${shipmentId}/delivery-candidates`,
  );
  return response.data.data;
}

export async function listDrivers(
  input?:
    | DriverStatus
    | {
        status?: DriverStatus;
        capability?: DriverCapability;
        operatingWarehouseId?: string;
        search?: string;
        fromDate?: string;
        toDate?: string;
        page?: number;
        limit?: number;
      },
): Promise<Paginated<DriverProfile>> {
  const params = typeof input === 'string' ? { status: input } : input;
  const response = await api.get<ApiEnvelope<Paginated<DriverProfile>>>('/drivers', {
    params: { page: 1, limit: 20, ...params },
  });
  return response.data.data;
}

export async function getMyDriverProfile(): Promise<DriverProfile> {
  const response = await api.get<ApiEnvelope<DriverProfile>>('/drivers/me');
  return response.data.data;
}

export async function setMyAvailability(isOnline: boolean): Promise<DriverProfile> {
  const response = await api.patch<ApiEnvelope<DriverProfile>>('/drivers/me/availability', {
    isOnline,
  });
  return response.data.data;
}

export async function createDriverProfile(input: {
  userId: string;
  operatingWarehouseId: string;
  employeeCode: string;
  vehicleType: string;
  vehiclePlate: string;
}): Promise<DriverProfile> {
  const response = await api.post<ApiEnvelope<DriverProfile>>('/drivers', input);
  return response.data.data;
}

export async function setDriverOperatingWarehouse(input: {
  driverId: string;
  operatingWarehouseId: string;
}): Promise<DriverProfile> {
  const response = await api.patch<ApiEnvelope<DriverProfile>>(`/drivers/${input.driverId}`, {
    operatingWarehouseId: input.operatingWarehouseId,
  });
  return response.data.data;
}

export async function setDriverSuspended(input: {
  driverId: string;
  suspended: boolean;
}): Promise<DriverProfile> {
  const response = await api.patch<ApiEnvelope<DriverProfile>>(`/drivers/${input.driverId}`, {
    suspended: input.suspended,
  });
  return response.data.data;
}

export async function setDriverCapabilities(input: {
  driverId: string;
  capabilities: DriverCapability[];
}): Promise<DriverProfile> {
  const response = await api.patch<ApiEnvelope<DriverProfile>>(
    `/drivers/${input.driverId}/capabilities`,
    { capabilities: input.capabilities },
  );
  return response.data.data;
}

export async function listMyAssignments(params?: {
  status?: Assignment['status'];
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<Assignment>> {
  const response = await api.get<ApiEnvelope<Paginated<Assignment>>>('/driver/assignments', {
    params: { page: 1, limit: 20, ...params },
  });
  return response.data.data;
}

export async function getMyAssignment(assignmentId: string): Promise<Assignment> {
  const response = await api.get<ApiEnvelope<Assignment>>(`/driver/assignments/${assignmentId}`);
  return response.data.data;
}

export async function acceptAssignment(assignmentId: string): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/driver/assignments/${assignmentId}/accept`,
  );
  return response.data.data;
}

export async function rejectAssignment(input: {
  assignmentId: string;
  reason: string;
}): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/driver/assignments/${input.assignmentId}/reject`,
    { reason: input.reason },
  );
  return response.data.data;
}

export async function pickupShipment(input: {
  assignmentId: string;
  note?: string;
  shippingFeeAmount?: number;
}): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/driver/assignments/${input.assignmentId}/pickup`,
    { note: input.note || undefined, shippingFeeAmount: input.shippingFeeAmount },
  );
  return response.data.data;
}

export async function assignDelivery(input: {
  shipmentId: string;
  driverId: string;
}): Promise<Assignment> {
  const response = await api.post<ApiEnvelope<Assignment>>(
    `/dispatcher/shipments/${input.shipmentId}/delivery-assignments`,
    { driverId: input.driverId, clientRequestId: crypto.randomUUID() },
  );
  return response.data.data;
}

export async function redeliver(shipmentId: string): Promise<OperationalShipment> {
  const response = await api.post<ApiEnvelope<OperationalShipment>>(
    `/dispatcher/shipments/${shipmentId}/redeliver`,
  );
  return response.data.data;
}

export async function requestReturn(
  shipmentId: string,
  note?: string,
): Promise<OperationalShipment> {
  const response = await api.post<ApiEnvelope<OperationalShipment>>(
    `/dispatcher/shipments/${shipmentId}/return/request`,
    { note },
  );
  return response.data.data;
}

export async function listMyDeliveryAssignments(params?: {
  view?: DriverDeliveryListView;
  status?: Assignment['status'];
  attemptStatus?: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<DeliveryAssignment>> {
  const response = await api.get<ApiEnvelope<Paginated<DeliveryAssignment>>>(
    '/driver/delivery-assignments',
    { params: { page: 1, limit: 20, ...params } },
  );
  return response.data.data;
}

export async function getMyDeliveryAssignment(assignmentId: string): Promise<DeliveryAssignment> {
  const response = await api.get<ApiEnvelope<DeliveryAssignment>>(
    `/driver/delivery-assignments/${assignmentId}`,
  );
  return response.data.data;
}

export async function startDelivery(assignmentId: string): Promise<DeliveryAssignment> {
  const response = await api.post<ApiEnvelope<DeliveryAssignment>>(
    `/driver/delivery-assignments/${assignmentId}/start`,
  );
  return response.data.data;
}

export async function completeDelivery(input: {
  assignmentId: string;
  receiverName: string;
  note?: string;
  shippingFeeAmount?: number;
}): Promise<DeliveryAssignment> {
  const response = await api.post<ApiEnvelope<DeliveryAssignment>>(
    `/driver/delivery-assignments/${input.assignmentId}/complete`,
    {
      receiverName: input.receiverName,
      note: input.note || undefined,
      shippingFeeAmount: input.shippingFeeAmount,
    },
  );
  return response.data.data;
}

export async function failDelivery(input: {
  assignmentId: string;
  reason: DeliveryFailureReason;
  note?: string;
}): Promise<DeliveryAssignment> {
  const response = await api.post<ApiEnvelope<DeliveryAssignment>>(
    `/driver/delivery-assignments/${input.assignmentId}/fail`,
    { reason: input.reason, note: input.note || undefined },
  );
  return response.data.data;
}
