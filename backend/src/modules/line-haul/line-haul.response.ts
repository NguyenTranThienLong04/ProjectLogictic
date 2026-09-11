import type { Prisma } from '../../generated/prisma/client.js';
import type { RouteMetric, RouteMetricMode } from '../routing/route-metrics.service.js';
import type { RouteGeometry } from '../routing/route-provider.js';
import {
  calculateManifestWeightGrams,
  resolveShipmentLoadWeightGrams,
  toManifestCapacityMetrics,
} from './line-haul-capacity.js';

export const lineHaulTripInclude = {
  originWarehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      city: true,
      latitude: true,
      longitude: true,
      isActive: true,
    },
  },
  destinationWarehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      city: true,
      latitude: true,
      longitude: true,
      isActive: true,
    },
  },
  driver: {
    include: {
      user: { select: { id: true, fullName: true, email: true, status: true, role: true } },
    },
  },
  vehicle: true,
  transferAssignments: {
    include: {
      warehouseTransfer: {
        include: {
          shipment: {
            select: {
              id: true,
              trackingCode: true,
              status: true,
              version: true,
              currentWarehouseId: true,
              destinationWarehouseId: true,
              packageSnapshot: true,
            },
          },
        },
      },
    },
    orderBy: { assignedAt: 'asc' },
  },
} satisfies Prisma.LineHaulTripInclude;

export type LineHaulTripRecord = Prisma.LineHaulTripGetPayload<{
  include: typeof lineHaulTripInclude;
}>;

export type LineHaulVehicleRecord = Prisma.LineHaulVehicleGetPayload<Record<string, never>>;

export const lineHaulTripRouteSelect = {
  id: true,
  tripId: true,
  version: true,
  type: true,
  startLatitude: true,
  startLongitude: true,
  destinationLatitude: true,
  destinationLongitude: true,
  distanceMeters: true,
  durationSeconds: true,
  metricMode: true,
  provider: true,
  geometry: true,
  calculatedAt: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.LineHaulTripRouteSelect;

export type LineHaulTripRouteRecord = Prisma.LineHaulTripRouteGetPayload<{
  select: typeof lineHaulTripRouteSelect;
}>;

export function toLineHaulVehicleResponse(vehicle: LineHaulVehicleRecord) {
  return {
    id: vehicle.id,
    vehicleCode: vehicle.vehicleCode,
    licensePlate: vehicle.licensePlate,
    vehicleType: vehicle.vehicleType,
    capacityWeightGrams: vehicle.capacityWeightGrams,
    status: vehicle.status,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}

export interface LineHaulTripAccess {
  canManage: boolean;
  canConfirmDestination: boolean;
  canReroute: boolean;
}

export interface RouteMetricResponse {
  distanceMeters: number;
  durationSeconds: number | null;
  mode: RouteMetricMode;
  provider: string;
  calculatedAt: string;
}

export function toLineHaulTripResponse(
  trip: LineHaulTripRecord,
  access: LineHaulTripAccess,
  remainingRoute: RouteMetric | null = null,
  routeHistory: LineHaulTripRouteRecord[] = [],
) {
  const activeAssignments = trip.transferAssignments.filter((assignment) => assignment.isActive);
  const receivedTransfers = activeAssignments.filter(
    (assignment) => assignment.warehouseTransfer.status === 'COMPLETED',
  ).length;
  const plannedRouteVersion = routeHistory.find((route) => route.type === 'PLANNED');
  const currentRouteVersion = routeHistory.find((route) => route.id === trip.currentRouteId);
  const manifestCapacity = toManifestCapacityMetrics(
    calculateManifestWeightGrams(activeAssignments),
    trip.vehicle.capacityWeightGrams,
  );
  return {
    id: trip.id,
    tripCode: trip.tripCode,
    originWarehouseId: trip.originWarehouseId,
    destinationWarehouseId: trip.destinationWarehouseId,
    driverId: trip.driverId,
    vehicleId: trip.vehicleId,
    status: trip.status,
    version: trip.version,
    plannedDepartureAt: trip.plannedDepartureAt,
    scheduledStartAt: trip.scheduledStartAt,
    scheduledEndAt: trip.scheduledEndAt,
    departedAt: trip.departedAt,
    arrivedAt: trip.arrivedAt,
    cancelledAt: trip.cancelledAt,
    cancellationReason: trip.cancellationReason,
    createdById: trip.createdById,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    plannedRoute: plannedRouteVersion
      ? toLineHaulTripRouteResponse(plannedRouteVersion)
      : trip.plannedDistanceMeters !== null &&
          trip.routeMetricMode !== null &&
          trip.routeProvider !== null &&
          trip.routeCalculatedAt !== null
        ? {
            distanceMeters: trip.plannedDistanceMeters,
            durationSeconds: trip.plannedDurationSeconds,
            mode: trip.routeMetricMode,
            provider: trip.routeProvider,
            calculatedAt: trip.routeCalculatedAt.toISOString(),
          }
        : null,
    remainingRoute: remainingRoute ? toRouteMetricResponse(remainingRoute) : null,
    currentRoute: currentRouteVersion ? toLineHaulTripRouteResponse(currentRouteVersion) : null,
    routeHistory: routeHistory.map(toLineHaulTripRouteResponse),
    manifest: {
      totalTransfers: activeAssignments.length,
      receivedTransfers,
      ...manifestCapacity,
      preparedManifestWeightGrams: trip.preparedManifestWeightGrams,
      preparedVehicleCapacityWeightGrams: trip.preparedVehicleCapacityWeightGrams,
    },
    availableActions: {
      addTransfer: access.canManage && trip.status === 'PLANNED',
      removeTransfer: access.canManage && trip.status === 'PLANNED',
      markReady:
        access.canManage &&
        trip.status === 'PLANNED' &&
        trip.scheduledStartAt !== null &&
        trip.scheduledEndAt !== null,
      schedule:
        access.canManage &&
        trip.status === 'PLANNED' &&
        trip.scheduledStartAt === null &&
        trip.scheduledEndAt === null,
      reschedule:
        access.canManage &&
        trip.status === 'PLANNED' &&
        trip.scheduledStartAt !== null &&
        trip.scheduledEndAt !== null,
      unschedule:
        access.canManage &&
        trip.status === 'PLANNED' &&
        trip.scheduledStartAt !== null &&
        trip.scheduledEndAt !== null,
      dispatch: access.canManage && trip.status === 'READY',
      cancel: access.canManage && (trip.status === 'PLANNED' || trip.status === 'READY'),
      arrive: access.canConfirmDestination && trip.status === 'IN_TRANSIT',
      receiveTransfers: access.canConfirmDestination && trip.status === 'ARRIVED',
      recalculateRoute: access.canReroute && trip.status === 'IN_TRANSIT',
    },
    originWarehouse: trip.originWarehouse,
    destinationWarehouse: trip.destinationWarehouse,
    driver: {
      id: trip.driver.id,
      fullName: trip.driver.user.fullName,
      employeeCode: trip.driver.employeeCode,
      status: trip.driver.status,
      capabilities: trip.driver.capabilities,
    },
    vehicle: toLineHaulVehicleResponse(trip.vehicle),
    transferAssignments: trip.transferAssignments.map((assignment) => ({
      id: assignment.id,
      isActive: assignment.isActive,
      assignedAt: assignment.assignedAt,
      removedAt: assignment.removedAt,
      warehouseTransfer: {
        id: assignment.warehouseTransfer.id,
        transferCode: assignment.warehouseTransfer.transferCode,
        status: assignment.warehouseTransfer.status,
        fromWarehouseId: assignment.warehouseTransfer.fromWarehouseId,
        toWarehouseId: assignment.warehouseTransfer.toWarehouseId,
        dispatchedAt: assignment.warehouseTransfer.dispatchedAt,
        receivedAt: assignment.warehouseTransfer.receivedAt,
        loadWeightGrams: resolveShipmentLoadWeightGrams(
          assignment.warehouseTransfer.shipment.packageSnapshot,
        ),
        shipment: {
          id: assignment.warehouseTransfer.shipment.id,
          trackingCode: assignment.warehouseTransfer.shipment.trackingCode,
          status: assignment.warehouseTransfer.shipment.status,
          packageSnapshot: assignment.warehouseTransfer.shipment.packageSnapshot,
        },
      },
    })),
  };
}

export function toLineHaulTripRouteResponse(route: LineHaulTripRouteRecord) {
  return {
    id: route.id,
    version: route.version,
    type: route.type,
    start: { latitude: Number(route.startLatitude), longitude: Number(route.startLongitude) },
    destination: {
      latitude: Number(route.destinationLatitude),
      longitude: Number(route.destinationLongitude),
    },
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    mode: route.metricMode,
    provider: route.provider,
    geometry: parseRouteGeometry(route.geometry),
    calculatedAt: route.calculatedAt.toISOString(),
    createdAt: route.createdAt.toISOString(),
    createdById: route.createdById,
  };
}

function parseRouteGeometry(value: Prisma.JsonValue | null): RouteGeometry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const points = (value as { points?: unknown }).points;
  if (!Array.isArray(points) || points.length < 2 || points.length > 2_000) return null;
  const normalized = points.flatMap((point) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
    const latitude = (point as { latitude?: unknown }).latitude;
    const longitude = (point as { longitude?: unknown }).longitude;
    return Number.isFinite(latitude) &&
      Number(latitude) >= -90 &&
      Number(latitude) <= 90 &&
      Number.isFinite(longitude) &&
      Number(longitude) >= -180 &&
      Number(longitude) <= 180
      ? [{ latitude: Number(latitude), longitude: Number(longitude) }]
      : [];
  });
  return normalized.length === points.length ? { points: normalized } : null;
}

function toRouteMetricResponse(metric: RouteMetric): RouteMetricResponse {
  return {
    distanceMeters: metric.distanceMeters,
    durationSeconds: metric.durationSeconds,
    mode: metric.mode,
    provider: metric.provider,
    calculatedAt: metric.calculatedAt.toISOString(),
  };
}
