import type { DriverCapability, DriverStatus } from '../operations/operations-types';
import type { ShipmentStatus } from '../shipments/shipment-types';
import type { PackageSnapshot } from '../shipments/shipment-types';
import type { WarehouseTransferStatus } from '../warehouses/warehouse-types';
import type { RouteMetricView } from '../../utils/route-metric';
import type { LineHaulRouteView } from './line-haul-route-types';

export type { DriverCapability } from '../operations/operations-types';
export type LineHaulVehicleStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'INACTIVE';
export type LineHaulTripStatus = 'PLANNED' | 'READY' | 'IN_TRANSIT' | 'ARRIVED' | 'CANCELLED';

export interface LineHaulVehicle {
  id: string;
  vehicleCode: string;
  licensePlate: string;
  vehicleType: string;
  capacityWeightGrams: number | null;
  status: LineHaulVehicleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EligibleLineHaulDriver {
  id: string;
  fullName: string;
  employeeCode: string;
  status: DriverStatus;
  capabilities: DriverCapability[];
}

export type LineHaulResourceAvailabilityState = 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE';

export interface LineHaulScheduleConflict {
  tripId: string;
  tripCode: string;
  status: LineHaulTripStatus;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
}

export interface LineHaulDriverAvailability extends EligibleLineHaulDriver {
  availability: LineHaulResourceAvailabilityState;
  unavailableReason: string | null;
  conflicts: LineHaulScheduleConflict[];
}

export interface LineHaulVehicleAvailability extends LineHaulVehicle {
  availability: LineHaulResourceAvailabilityState;
  unavailableReason: string | null;
  conflicts: LineHaulScheduleConflict[];
}

export interface LineHaulResourceAvailability {
  scheduledStartAt: string;
  scheduledEndAt: string;
  drivers: LineHaulDriverAvailability[];
  vehicles: LineHaulVehicleAvailability[];
}

export interface LineHaulWarehouse {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  isActive: boolean;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface LineHaulTripTransferAssignment {
  id: string;
  isActive: boolean;
  assignedAt: string;
  removedAt: string | null;
  warehouseTransfer: {
    id: string;
    transferCode: string;
    status: WarehouseTransferStatus;
    fromWarehouseId: string;
    toWarehouseId: string;
    dispatchedAt: string | null;
    receivedAt: string | null;
    loadWeightGrams: number;
    shipment: {
      id: string;
      trackingCode: string;
      status: ShipmentStatus;
      packageSnapshot: PackageSnapshot;
    };
  };
}

export interface LineHaulTrip {
  id: string;
  tripCode: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  driverId: string;
  vehicleId: string;
  status: LineHaulTripStatus;
  version: number;
  plannedDepartureAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  plannedRoute: LineHaulRouteView | null;
  remainingRoute: RouteMetricView | null;
  currentRoute: LineHaulRouteView | null;
  routeHistory: LineHaulRouteView[];
  manifest: {
    totalTransfers: number;
    receivedTransfers: number;
    manifestWeightGrams: number;
    vehicleCapacityWeightGrams: number | null;
    remainingCapacityWeightGrams: number | null;
    capacityUtilizationPercent: number | null;
    preparedManifestWeightGrams: number | null;
    preparedVehicleCapacityWeightGrams: number | null;
  };
  availableActions: {
    addTransfer: boolean;
    removeTransfer: boolean;
    markReady: boolean;
    schedule: boolean;
    reschedule: boolean;
    unschedule: boolean;
    dispatch: boolean;
    cancel: boolean;
    arrive: boolean;
    receiveTransfers: boolean;
    recalculateRoute: boolean;
  };
  originWarehouse: LineHaulWarehouse;
  destinationWarehouse: LineHaulWarehouse;
  driver: EligibleLineHaulDriver;
  vehicle: LineHaulVehicle;
  transferAssignments: LineHaulTripTransferAssignment[];
}

export interface EligibleWarehouseTransfer {
  id: string;
  transferCode: string;
  status: 'PENDING';
  loadWeightGrams: number;
  projectedManifestWeightGrams: number;
  remainingCapacityAfterAddGrams: number;
  fitsVehicleCapacity: boolean;
  shipment: { id: string; trackingCode: string; status: ShipmentStatus };
}

export interface PaginatedLineHaul<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface LineHaulPlanningReason {
  code:
    | 'CAPACITY_UTILIZATION'
    | 'TRANSFER_CONSOLIDATION'
    | 'EARLY_DEPARTURE'
    | 'ROUTE_METRIC_QUALITY'
    | 'DRIVER_ORIGIN_ALIGNMENT';
  label: string;
  points: number;
}

export interface LineHaulPlanningTransfer {
  id: string;
  transferCode: string;
  trackingCode: string;
  loadWeightGrams: number;
  createdAt: string;
}

export interface LineHaulPlanningRecommendation {
  rank: number;
  score: number;
  originWarehouseId: string;
  destinationWarehouseId: string;
  driver: {
    id: string;
    fullName: string;
    employeeCode: string;
    operatingWarehouseId: string | null;
  };
  vehicle: {
    id: string;
    vehicleCode: string;
    licensePlate: string;
    vehicleType: string;
    capacityWeightGrams: number;
  };
  scheduledStartAt: string;
  scheduledEndAt: string;
  manifestWeightGrams: number;
  capacityUtilizationPercent: number;
  remainingCapacityWeightGrams: number;
  transfers: LineHaulPlanningTransfer[];
  route: {
    distanceMeters: number;
    durationSeconds: number | null;
    mode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
    calculatedAt: string;
  } | null;
  reasons: LineHaulPlanningReason[];
}

export interface LineHaulPlanningResult {
  algorithmVersion: 'G3C3_RULES_V1';
  advisoryOnly: true;
  criteria: {
    originWarehouse: { id: string; code: string; name: string };
    destinationWarehouse: { id: string; code: string; name: string };
    earliestStartAt: string;
    latestEndAt: string;
    slotMinutes: number;
    windowDurationMinutes: number;
    durationBasis: 'ROAD_ROUTE' | 'POLICY_FALLBACK';
    routeBufferMinutes: number;
    fallbackDurationMinutes: number;
    eligibleTransferCount: number;
  };
  route: LineHaulPlanningRecommendation['route'];
  recommendations: LineHaulPlanningRecommendation[];
}
