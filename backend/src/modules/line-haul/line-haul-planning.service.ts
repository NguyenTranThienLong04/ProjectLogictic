import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  DriverCapability,
  DriverStatus,
  LineHaulVehicleStatus,
  Prisma,
  ShipmentStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { activeAssignmentStatuses } from '../assignments/assignment.policy.js';
import { RouteMetricsService } from '../routing/route-metrics.service.js';
import type { RoutePoint } from '../routing/route-provider.js';
import type { LineHaulPlanningRecommendationsDto } from './dto/line-haul-planning-recommendations.dto.js';
import {
  activeLineHaulTripStatuses,
  executingLineHaulTripStatuses,
} from './line-haul.constants.js';
import {
  MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS,
  resolveShipmentLoadWeightGrams,
} from './line-haul-capacity.js';
import { LineHaulPolicy } from './line-haul.policy.js';
import {
  LINE_HAUL_PLANNING_ALGORITHM_VERSION,
  LINE_HAUL_PLANNING_FALLBACK_DURATION_MINUTES,
  LINE_HAUL_PLANNING_MAX_DRIVERS,
  LINE_HAUL_PLANNING_MAX_HORIZON_DAYS,
  LINE_HAUL_PLANNING_MAX_TRANSFERS,
  LINE_HAUL_PLANNING_MAX_VEHICLES,
  LINE_HAUL_PLANNING_ROUTE_BUFFER_MINUTES,
  LINE_HAUL_PLANNING_SLOT_MINUTES,
  resolvePlanningDurationMinutes,
  scoreLineHaulPlanning,
} from './line-haul-planning.policy.js';

@Injectable()
export class LineHaulPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: LineHaulPolicy,
    private readonly routes: RouteMetricsService,
  ) {}

  async recommendations(query: LineHaulPlanningRecommendationsDto) {
    this.policy.assertDistinctWarehouses(query.originWarehouseId, query.destinationWarehouseId);
    const earliestStartAt = new Date(query.earliestStartAt);
    const latestEndAt = new Date(query.latestEndAt);
    this.policy.assertScheduleWindow(earliestStartAt, latestEndAt);
    if (
      latestEndAt.getTime() - earliestStartAt.getTime() >
      LINE_HAUL_PLANNING_MAX_HORIZON_DAYS * 86_400_000
    ) {
      throw new BadRequestException({
        code: 'LINE_HAUL_PLANNING_HORIZON_TOO_LARGE',
        message: `Planning horizon cannot exceed ${LINE_HAUL_PLANNING_MAX_HORIZON_DAYS} days`,
      });
    }

    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        id: { in: [query.originWarehouseId, query.destinationWarehouseId] },
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        latitude: true,
        longitude: true,
      },
    });
    if (warehouses.length !== 2) {
      throw new ConflictException({
        code: 'LINE_HAUL_WAREHOUSE_INACTIVE',
        message: 'Origin and destination warehouses must both exist and be active',
      });
    }
    const origin = warehouses.find((warehouse) => warehouse.id === query.originWarehouseId)!;
    const destination = warehouses.find(
      (warehouse) => warehouse.id === query.destinationWarehouseId,
    )!;
    const [drivers, vehicles, transfers] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where: {
          status: { not: DriverStatus.SUSPENDED },
          capabilities: { has: DriverCapability.LINE_HAUL },
          user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
          assignments: { none: { status: { in: activeAssignmentStatuses } } },
          lineHaulTrips: { none: { status: { in: executingLineHaulTripStatuses } } },
        },
        select: {
          id: true,
          employeeCode: true,
          operatingWarehouseId: true,
          user: { select: { fullName: true } },
        },
        orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        take: LINE_HAUL_PLANNING_MAX_DRIVERS,
      }),
      this.prisma.lineHaulVehicle.findMany({
        where: {
          status: LineHaulVehicleStatus.AVAILABLE,
          capacityWeightGrams: { gt: 0, lte: MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS },
        },
        select: {
          id: true,
          vehicleCode: true,
          licensePlate: true,
          vehicleType: true,
          capacityWeightGrams: true,
        },
        orderBy: [{ vehicleCode: 'asc' }, { id: 'asc' }],
        take: LINE_HAUL_PLANNING_MAX_VEHICLES,
      }),
      this.prisma.warehouseTransfer.findMany({
        where: {
          fromWarehouseId: query.originWarehouseId,
          toWarehouseId: query.destinationWarehouseId,
          status: WarehouseTransferStatus.PENDING,
          lineHaulTripAssignments: { none: { isActive: true } },
          shipment: {
            status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
            currentWarehouseId: query.originWarehouseId,
            destinationWarehouseId: query.destinationWarehouseId,
          },
        },
        select: {
          id: true,
          transferCode: true,
          createdAt: true,
          shipment: {
            select: { trackingCode: true, packageSnapshot: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LINE_HAUL_PLANNING_MAX_TRANSFERS,
      }),
    ]);

    const route =
      drivers.length > 0 && vehicles.length > 0 && transfers.length > 0
        ? await this.routeMetric(origin, destination)
        : null;
    const durationMinutes = resolvePlanningDurationMinutes(route?.durationSeconds ?? null);
    if (earliestStartAt.getTime() + durationMinutes * 60_000 > latestEndAt.getTime()) {
      throw new BadRequestException({
        code: 'LINE_HAUL_PLANNING_WINDOW_TOO_SHORT',
        message: `Planning range needs at least ${durationMinutes} minutes for this route`,
      });
    }

    const conflicts =
      drivers.length === 0 || vehicles.length === 0
        ? []
        : await this.prisma.lineHaulTrip.findMany({
            where: {
              AND: [
                { status: { in: activeLineHaulTripStatuses } },
                {
                  OR: [
                    {
                      scheduledStartAt: { lt: latestEndAt },
                      scheduledEndAt: { gt: earliestStartAt },
                    },
                    { scheduledStartAt: null, status: { in: executingLineHaulTripStatuses } },
                  ],
                },
                {
                  OR: [
                    { driverId: { in: drivers.map(({ id }) => id) } },
                    { vehicleId: { in: vehicles.map(({ id }) => id) } },
                  ],
                },
              ],
            },
            select: {
              driverId: true,
              vehicleId: true,
              scheduledStartAt: true,
              scheduledEndAt: true,
            },
          });

    const mappedTransfers = transfers.map((transfer) => ({
      id: transfer.id,
      transferCode: transfer.transferCode,
      trackingCode: transfer.shipment.trackingCode,
      loadWeightGrams: resolveShipmentLoadWeightGrams(transfer.shipment.packageSnapshot),
      createdAt: transfer.createdAt,
    }));
    const recommendations = scoreLineHaulPlanning({
      originWarehouseId: query.originWarehouseId,
      destinationWarehouseId: query.destinationWarehouseId,
      earliestStartAt,
      latestEndAt,
      drivers: drivers.map((driver) => ({
        id: driver.id,
        employeeCode: driver.employeeCode,
        fullName: driver.user.fullName,
        operatingWarehouseId: driver.operatingWarehouseId,
      })),
      vehicles: vehicles.map((vehicle) => ({
        ...vehicle,
        capacityWeightGrams: vehicle.capacityWeightGrams!,
      })),
      transfers: mappedTransfers,
      conflicts,
      route,
      maxRecommendations: query.maxRecommendations,
    });

    return {
      algorithmVersion: LINE_HAUL_PLANNING_ALGORITHM_VERSION,
      advisoryOnly: true,
      criteria: {
        originWarehouse: { id: origin.id, code: origin.code, name: origin.name },
        destinationWarehouse: {
          id: destination.id,
          code: destination.code,
          name: destination.name,
        },
        earliestStartAt,
        latestEndAt,
        slotMinutes: LINE_HAUL_PLANNING_SLOT_MINUTES,
        windowDurationMinutes: durationMinutes,
        durationBasis: route?.durationSeconds === null || !route ? 'POLICY_FALLBACK' : 'ROAD_ROUTE',
        routeBufferMinutes: LINE_HAUL_PLANNING_ROUTE_BUFFER_MINUTES,
        fallbackDurationMinutes: LINE_HAUL_PLANNING_FALLBACK_DURATION_MINUTES,
        eligibleTransferCount: mappedTransfers.length,
      },
      route,
      recommendations,
    };
  }

  private async routeMetric(
    origin: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null },
    destination: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null },
  ) {
    const originPoint = this.warehousePoint(origin);
    const destinationPoint = this.warehousePoint(destination);
    if (!originPoint || !destinationPoint) return null;
    const metric = await this.routes.calculate({
      origin: originPoint,
      destination: destinationPoint,
    });
    return {
      distanceMeters: metric.distanceMeters,
      durationSeconds: metric.durationSeconds,
      mode: metric.mode,
      calculatedAt: metric.calculatedAt,
    };
  }

  private warehousePoint(warehouse: {
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  }): RoutePoint | null {
    if (warehouse.latitude === null || warehouse.longitude === null) return null;
    const latitude = Number(warehouse.latitude);
    const longitude = Number(warehouse.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    return { latitude, longitude };
  }
}
