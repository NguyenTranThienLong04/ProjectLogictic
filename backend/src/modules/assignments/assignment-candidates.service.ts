import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { executingLineHaulTripStatuses } from '../line-haul/line-haul.constants.js';
import { LocationsService } from '../locations/locations.service.js';
import type { AddressSnapshot } from '../shipments/shipment.response.js';
import { RouteMetricsService, type RouteMetricMode } from '../routing/route-metrics.service.js';
import {
  AssignmentPolicy,
  type AssignmentEligibilityIssue,
  type AssignmentTarget,
  type LocationAwareDriver,
} from './assignment.policy.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';

const candidateDriverInclude = {
  user: true,
  operatingWarehouse: true,
} satisfies Prisma.DriverProfileInclude;

interface CandidateShipment {
  id: string;
  status: ShipmentStatus;
  pickupSnapshot: Prisma.JsonValue;
  destinationWarehouseId: string | null;
  destinationWarehouse: {
    id: string;
    code: string;
    name: string;
    city: string;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  } | null;
}

export interface AssignmentCandidateResponse {
  assignmentType: DriverAssignmentType;
  distanceMethod: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK' | 'MIXED';
  distanceNotice: string;
  target: {
    label: string;
    city: string;
  };
  candidates: Array<{
    id: string;
    fullName: string;
    employeeCode: string;
    vehicleType: string;
    vehiclePlate: string;
    operatingWarehouse: { id: string; code: string; name: string; city: string };
    estimatedDistanceKm: number;
    distanceMeters: number;
    durationSeconds: number | null;
    metricMode: RouteMetricMode;
    routeProvider: string;
    metricCalculatedAt: string;
    locationUpdatedAt: string;
  }>;
  exclusions: {
    missingCapability: number;
    noOperatingWarehouse: number;
    outsideOperatingArea: number;
    noCurrentLocation: number;
  };
}

@Injectable()
export class AssignmentCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly policy: AssignmentPolicy,
    private readonly transitionPolicy: ShipmentTransitionPolicy,
    private readonly routes: RouteMetricsService,
  ) {}

  async listPickup(shipmentId: string): Promise<AssignmentCandidateResponse> {
    const shipment = await this.getShipment(shipmentId);
    if (shipment.status === ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT) {
      this.transitionPolicy.assertAssignable(shipment.status);
    } else {
      this.transitionPolicy.assertReassignable(shipment.status);
    }
    return this.listForTarget(this.pickupTarget(shipment));
  }

  async listDelivery(shipmentId: string): Promise<AssignmentCandidateResponse> {
    const shipment = await this.getShipment(shipmentId);
    this.transitionPolicy.assertDeliveryAssignable(shipment.status);
    return this.listForTarget(this.deliveryTarget(shipment));
  }

  async assertPickupEligible(
    driver: LocationAwareDriver,
    shipment: Pick<CandidateShipment, 'pickupSnapshot'>,
  ): Promise<number> {
    const location = await this.locations.getCurrentDriverLocation(driver.id);
    return this.policy.assertLocationAwareEligible(driver, this.pickupTarget(shipment), location);
  }

  async assertDeliveryEligible(
    driver: LocationAwareDriver,
    shipment: Pick<CandidateShipment, 'destinationWarehouseId' | 'destinationWarehouse'>,
  ): Promise<number> {
    const location = await this.locations.getCurrentDriverLocation(driver.id);
    return this.policy.assertLocationAwareEligible(driver, this.deliveryTarget(shipment), location);
  }

  private async listForTarget(target: AssignmentTarget): Promise<AssignmentCandidateResponse> {
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
        user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        lineHaulTrips: { none: { status: { in: executingLineHaulTripStatuses } } },
      },
      include: candidateDriverInclude,
      orderBy: { employeeCode: 'asc' },
    });
    const locations = await this.locations.getCurrentDriverLocations(
      drivers.map((driver) => driver.id),
    );
    const exclusions = {
      missingCapability: 0,
      noOperatingWarehouse: 0,
      outsideOperatingArea: 0,
      noCurrentLocation: 0,
    };
    const eligible = drivers.flatMap((driver) => {
      const location = locations.get(driver.id) ?? null;
      const eligibility = this.policy.evaluate(driver, target, location);
      if (!eligibility.eligible || eligibility.estimatedDistanceKm === null || !location) {
        this.countExclusion(exclusions, eligibility.issue);
        return [];
      }
      const warehouse = driver.operatingWarehouse;
      if (!warehouse) return [];
      return [
        {
          driver,
          location,
          haversineDistanceKm: eligibility.estimatedDistanceKm,
          warehouse,
        },
      ];
    });
    eligible.sort(
      (left, right) =>
        left.haversineDistanceKm - right.haversineDistanceKm ||
        left.driver.employeeCode.localeCompare(right.driver.employeeCode),
    );
    const metrics = await this.routes.calculateBatch(
      eligible.map(({ location }) => ({
        origin: { latitude: location.latitude, longitude: location.longitude },
        destination: { latitude: target.latitude, longitude: target.longitude },
      })),
    );
    const candidates = eligible.map(({ driver, location, warehouse }, index) => {
      const metric = metrics[index];
      return {
        id: driver.id,
        fullName: driver.user.fullName,
        employeeCode: driver.employeeCode,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
        operatingWarehouse: {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          city: warehouse.city,
        },
        estimatedDistanceKm: Math.round((metric.distanceMeters / 1_000) * 100) / 100,
        distanceMeters: metric.distanceMeters,
        durationSeconds: metric.durationSeconds,
        metricMode: metric.mode,
        routeProvider: metric.provider,
        metricCalculatedAt: metric.calculatedAt.toISOString(),
        locationUpdatedAt: location.updatedAt,
      };
    });
    candidates.sort(
      (left, right) =>
        Number(right.metricMode === 'ROAD_ROUTE') - Number(left.metricMode === 'ROAD_ROUTE') ||
        left.distanceMeters - right.distanceMeters ||
        (left.durationSeconds ?? Number.MAX_SAFE_INTEGER) -
          (right.durationSeconds ?? Number.MAX_SAFE_INTEGER) ||
        left.employeeCode.localeCompare(right.employeeCode),
    );
    const roadCount = candidates.filter(
      (candidate) => candidate.metricMode === 'ROAD_ROUTE',
    ).length;
    const distanceMethod =
      roadCount === candidates.length && candidates.length > 0
        ? 'ROAD_ROUTE'
        : roadCount > 0
          ? 'MIXED'
          : 'HAVERSINE_FALLBACK';
    return {
      assignmentType: target.type,
      distanceMethod,
      distanceNotice:
        distanceMethod === 'ROAD_ROUTE'
          ? 'Xếp hạng theo khoảng cách đường bộ và thời gian dự kiến.'
          : distanceMethod === 'MIXED'
            ? 'Một số tuyến không khả dụng; các tuyến đó dùng khoảng cách ước tính và không có ETA.'
            : 'Route provider không khả dụng; đang dùng khoảng cách ước tính và không có ETA.',
      target: { label: target.city, city: target.city },
      candidates,
      exclusions,
    };
  }

  private pickupTarget(shipment: Pick<CandidateShipment, 'pickupSnapshot'>): AssignmentTarget {
    const pickup = shipment.pickupSnapshot as unknown as AddressSnapshot;
    return {
      type: DriverAssignmentType.PICKUP,
      warehouseId: null,
      city: pickup.city,
      ...this.coordinates(pickup.latitude, pickup.longitude, 'pickup location'),
    };
  }

  private deliveryTarget(
    shipment: Pick<CandidateShipment, 'destinationWarehouseId' | 'destinationWarehouse'>,
  ): AssignmentTarget {
    if (!shipment.destinationWarehouseId || !shipment.destinationWarehouse) {
      throw new UnprocessableEntityException({
        code: 'DESTINATION_WAREHOUSE_REQUIRED',
        message: 'Set the destination warehouse before listing delivery candidates',
      });
    }
    const warehouse = shipment.destinationWarehouse;
    return {
      type: DriverAssignmentType.DELIVERY,
      warehouseId: warehouse.id,
      city: warehouse.city,
      ...this.coordinates(warehouse.latitude, warehouse.longitude, 'destination warehouse'),
    };
  }

  private coordinates(
    latitudeValue: number | Prisma.Decimal | null | undefined,
    longitudeValue: number | Prisma.Decimal | null | undefined,
    targetName: string,
  ): { latitude: number; longitude: number } {
    const latitude =
      latitudeValue === null || latitudeValue === undefined ? NaN : Number(latitudeValue);
    const longitude =
      longitudeValue === null || longitudeValue === undefined ? NaN : Number(longitudeValue);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new UnprocessableEntityException({
        code: 'ASSIGNMENT_TARGET_LOCATION_REQUIRED',
        message: `A valid ${targetName} coordinate is required for distance ranking`,
      });
    }
    return { latitude, longitude };
  }

  private countExclusion(
    exclusions: AssignmentCandidateResponse['exclusions'],
    issue: AssignmentEligibilityIssue | null,
  ): void {
    if (issue === 'DRIVER_CAPABILITY_REQUIRED') exclusions.missingCapability += 1;
    if (issue === 'DRIVER_OPERATING_WAREHOUSE_REQUIRED') exclusions.noOperatingWarehouse += 1;
    if (issue === 'DRIVER_OUTSIDE_OPERATING_AREA') exclusions.outsideOperatingArea += 1;
    if (issue === 'DRIVER_CURRENT_LOCATION_REQUIRED') exclusions.noCurrentLocation += 1;
  }

  private async getShipment(shipmentId: string): Promise<CandidateShipment> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        pickupSnapshot: true,
        destinationWarehouseId: true,
        destinationWarehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            city: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment was not found',
      });
    }
    return shipment;
  }
}
