import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type {
  DriverCapability,
  EligibleLineHaulDriver,
  EligibleWarehouseTransfer,
  LineHaulTrip,
  LineHaulResourceAvailability,
  LineHaulTripStatus,
  LineHaulVehicle,
  LineHaulVehicleStatus,
  LineHaulPlanningResult,
  PaginatedLineHaul,
} from './line-haul-types';

export async function createLineHaulVehicle(input: {
  vehicleCode: string;
  licensePlate: string;
  vehicleType: string;
  capacityWeightGrams: number;
}): Promise<LineHaulVehicle> {
  const response = await api.post<ApiEnvelope<LineHaulVehicle>>('/line-haul/vehicles', input);
  return response.data.data;
}

export async function updateLineHaulVehicleCapacity(input: {
  vehicleId: string;
  capacityWeightGrams: number;
}): Promise<LineHaulVehicle> {
  const response = await api.post<ApiEnvelope<LineHaulVehicle>>(
    `/line-haul/vehicles/${input.vehicleId}/update-capacity`,
    { capacityWeightGrams: input.capacityWeightGrams },
  );
  return response.data.data;
}

export async function listLineHaulVehicles(params?: {
  status?: LineHaulVehicleStatus;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedLineHaul<LineHaulVehicle>> {
  const response = await api.get<ApiEnvelope<PaginatedLineHaul<LineHaulVehicle>>>(
    '/line-haul/vehicles',
    { params: { page: 1, limit: 20, ...params } },
  );
  return response.data.data;
}

export async function setLineHaulVehicleStatus(input: {
  vehicleId: string;
  status: Exclude<LineHaulVehicleStatus, 'IN_USE'>;
}): Promise<LineHaulVehicle> {
  const command =
    input.status === 'AVAILABLE'
      ? 'activate'
      : input.status === 'MAINTENANCE'
        ? 'mark-maintenance'
        : 'deactivate';
  const response = await api.post<ApiEnvelope<LineHaulVehicle>>(
    `/line-haul/vehicles/${input.vehicleId}/${command}`,
  );
  return response.data.data;
}

export async function listEligibleLineHaulDrivers(search?: string) {
  const response = await api.get<ApiEnvelope<EligibleLineHaulDriver[]>>(
    '/line-haul/trips/eligible-drivers',
    { params: { search, limit: 100 } },
  );
  return response.data.data;
}

export async function listEligibleLineHaulVehicles(search?: string) {
  const response = await api.get<ApiEnvelope<LineHaulVehicle[]>>(
    '/line-haul/trips/eligible-vehicles',
    { params: { search, limit: 100 } },
  );
  return response.data.data;
}

export async function createLineHaulTrip(input: {
  originWarehouseId: string;
  destinationWarehouseId: string;
  driverId: string;
  vehicleId: string;
  plannedDepartureAt?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  warehouseTransferIds?: string[];
}): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>('/line-haul/trips', {
    ...input,
    clientRequestId: crypto.randomUUID(),
  });
  return response.data.data;
}

export async function getLineHaulPlanningRecommendations(input: {
  originWarehouseId: string;
  destinationWarehouseId: string;
  earliestStartAt: string;
  latestEndAt: string;
  maxRecommendations?: number;
}): Promise<LineHaulPlanningResult> {
  const response = await api.get<ApiEnvelope<LineHaulPlanningResult>>(
    '/line-haul/planning/recommendations',
    { params: input },
  );
  return response.data.data;
}

export async function listLineHaulTrips(params?: {
  status?: LineHaulTripStatus;
  originWarehouseId?: string;
  destinationWarehouseId?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedLineHaul<LineHaulTrip>> {
  const response = await api.get<ApiEnvelope<PaginatedLineHaul<LineHaulTrip>>>('/line-haul/trips', {
    params: { page: 1, limit: 20, ...params },
  });
  return response.data.data;
}

export async function getLineHaulResourceAvailability(input: {
  scheduledStartAt: string;
  scheduledEndAt: string;
  tripId?: string;
  search?: string;
}): Promise<LineHaulResourceAvailability> {
  const response = await api.get<ApiEnvelope<LineHaulResourceAvailability>>(
    '/line-haul/trips/resource-availability',
    { params: { ...input, limit: 100 } },
  );
  return response.data.data;
}

export async function scheduleLineHaulTrip(input: {
  tripId: string;
  expectedVersion: number;
  scheduledStartAt: string;
  scheduledEndAt: string;
}): Promise<LineHaulTrip> {
  const { tripId, ...body } = input;
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${tripId}/schedule`,
    body,
  );
  return response.data.data;
}

export async function rescheduleLineHaulTrip(input: {
  tripId: string;
  expectedVersion: number;
  scheduledStartAt: string;
  scheduledEndAt: string;
}): Promise<LineHaulTrip> {
  const { tripId, ...body } = input;
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${tripId}/reschedule`,
    body,
  );
  return response.data.data;
}

export async function unscheduleLineHaulTrip(input: {
  tripId: string;
  expectedVersion: number;
}): Promise<LineHaulTrip> {
  const { tripId, ...body } = input;
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${tripId}/unschedule`,
    body,
  );
  return response.data.data;
}

export async function getLineHaulTrip(id: string): Promise<LineHaulTrip> {
  const response = await api.get<ApiEnvelope<LineHaulTrip>>(`/line-haul/trips/${id}`);
  return response.data.data;
}

export async function listEligibleWarehouseTransfers(
  tripId: string,
  search?: string,
): Promise<EligibleWarehouseTransfer[]> {
  const response = await api.get<ApiEnvelope<EligibleWarehouseTransfer[]>>(
    `/line-haul/trips/${tripId}/eligible-transfers`,
    { params: { search, limit: 100 } },
  );
  return response.data.data;
}

export async function assignWarehouseTransferToTrip(input: {
  tripId: string;
  transferId: string;
}): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${input.tripId}/transfers`,
    { transferId: input.transferId },
  );
  return response.data.data;
}

export async function removeWarehouseTransferFromTrip(input: {
  tripId: string;
  transferId: string;
}): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${input.tripId}/transfers/${input.transferId}/remove`,
  );
  return response.data.data;
}

export async function cancelLineHaulTrip(input: {
  tripId: string;
  reason: string;
}): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${input.tripId}/cancel`,
    { reason: input.reason },
  );
  return response.data.data;
}

export async function prepareLineHaulTrip(tripId: string): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(`/line-haul/trips/${tripId}/prepare`);
  return response.data.data;
}

export async function dispatchLineHaulTrip(tripId: string): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(`/line-haul/trips/${tripId}/dispatch`);
  return response.data.data;
}

export async function arriveLineHaulTrip(tripId: string): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(`/line-haul/trips/${tripId}/arrive`);
  return response.data.data;
}

export async function recalculateLineHaulTripRoute(tripId: string): Promise<LineHaulTrip> {
  const response = await api.post<ApiEnvelope<LineHaulTrip>>(
    `/line-haul/trips/${tripId}/recalculate-route`,
  );
  return response.data.data;
}

export type { DriverCapability };
