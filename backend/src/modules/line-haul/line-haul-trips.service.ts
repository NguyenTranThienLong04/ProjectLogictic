import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulVehicleStatus,
  Prisma,
  RouteMetricMode,
  ShipmentStatus,
  TrackingVisibility,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { DriverTaskOwnershipService } from '../assignments/driver-task-ownership.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { LOCATION_TTL_MILLISECONDS } from '../locations/locations.service.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RouteDeviationService } from '../routing/route-deviation.service.js';
import { RouteMetricsService, type RouteMetric } from '../routing/route-metrics.service.js';
import type { RoutePoint } from '../routing/route-provider.js';
import { WarehouseTransferLifecycleService } from '../warehouses/warehouse-transfer-lifecycle.service.js';
import type { AssignLineHaulTransferDto } from './dto/assign-line-haul-transfer.dto.js';
import type { CancelLineHaulTripDto } from './dto/cancel-line-haul-trip.dto.js';
import type { CreateLineHaulTripDto } from './dto/create-line-haul-trip.dto.js';
import type { ListEligibleLineHaulResourcesDto } from './dto/list-eligible-line-haul-resources.dto.js';
import type { LineHaulResourceAvailabilityDto } from './dto/line-haul-resource-availability.dto.js';
import type { ListLineHaulTripsDto } from './dto/list-line-haul-trips.dto.js';
import type { ScheduleLineHaulTripDto } from './dto/schedule-line-haul-trip.dto.js';
import type { UnscheduleLineHaulTripDto } from './dto/unschedule-line-haul-trip.dto.js';
import {
  activeLineHaulTripStatuses,
  executingLineHaulTripStatuses,
} from './line-haul.constants.js';
import {
  MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS,
  assertManifestWithinCapacity,
  calculateManifestWeightGrams,
  resolveShipmentLoadWeightGrams,
} from './line-haul-capacity.js';
import { LineHaulPolicy } from './line-haul.policy.js';
import {
  lineHaulTripInclude,
  lineHaulTripRouteSelect,
  toLineHaulTripResponse,
  toLineHaulVehicleResponse,
  type LineHaulTripRecord,
} from './line-haul.response.js';

@Injectable()
export class LineHaulTripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: LineHaulPolicy,
    private readonly driverOwnership: DriverTaskOwnershipService,
    private readonly transferLifecycle: WarehouseTransferLifecycleService,
    private readonly notifications: NotificationsService,
    private readonly locations: LocationsService,
    private readonly routes: RouteMetricsService,
    private readonly routeDeviation: RouteDeviationService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateLineHaulTripDto, context: ClientContext) {
    this.policy.assertDistinctWarehouses(dto.originWarehouseId, dto.destinationWarehouseId);
    const scheduleWindow = this.parseOptionalCreateSchedule(dto);
    const transferIds = [...(dto.warehouseTransferIds ?? [])].sort();
    const existing = await this.prisma.lineHaulTrip.findUnique({
      where: {
        createdById_clientRequestId: {
          createdById: actor.id,
          clientRequestId: dto.clientRequestId,
        },
      },
      include: lineHaulTripInclude,
    });
    if (existing) {
      this.assertIdempotency(existing, dto);
      return this.toResponse(existing, actor);
    }

    try {
      const trip = await this.prisma.$transaction(async (transaction) => {
        await this.driverOwnership.lock(transaction, dto.driverId);
        await this.lockVehicle(transaction, dto.vehicleId);
        if (transferIds.length > 0) {
          await transaction.$queryRaw(
            Prisma.sql`
              SELECT "id" FROM "WarehouseTransfer"
              WHERE "id" IN (${Prisma.join(
                transferIds.map((transferId) => Prisma.sql`${transferId}::uuid`),
              )})
              ORDER BY "id" FOR UPDATE
            `,
          );
        }
        const warehouses = await transaction.warehouse.findMany({
          where: {
            id: { in: [dto.originWarehouseId, dto.destinationWarehouseId] },
            isActive: true,
          },
          select: { id: true },
        });
        if (warehouses.length !== 2) {
          throw new ConflictException({
            code: 'LINE_HAUL_WAREHOUSE_INACTIVE',
            message: 'Origin and destination warehouses must both exist and be active',
          });
        }

        const driver = await transaction.driverProfile.findUnique({
          where: { id: dto.driverId },
          include: { user: true },
        });
        if (!driver) this.notFound('LINE_HAUL_DRIVER_NOT_FOUND', 'Driver profile was not found');
        this.policy.assertDriverEligible(driver);

        const vehicle = await transaction.lineHaulVehicle.findUnique({
          where: { id: dto.vehicleId },
        });
        if (!vehicle) this.notFound('LINE_HAUL_VEHICLE_NOT_FOUND', 'Vehicle was not found');
        this.policy.assertVehicleEligible(vehicle);

        if (scheduleWindow) {
          await this.driverOwnership.assertNoActiveAssignment(transaction, driver.id);
          await this.assertScheduleResourcesAvailableByIds(
            transaction,
            driver.id,
            vehicle.id,
            scheduleWindow.start,
            scheduleWindow.end,
          );
        }

        const transfers =
          transferIds.length === 0
            ? []
            : await transaction.warehouseTransfer.findMany({
                where: { id: { in: transferIds } },
                include: {
                  shipment: {
                    select: {
                      status: true,
                      currentWarehouseId: true,
                      destinationWarehouseId: true,
                      packageSnapshot: true,
                    },
                  },
                  lineHaulTripAssignments: { where: { isActive: true }, select: { id: true } },
                },
                orderBy: { id: 'asc' },
              });
        if (transfers.length !== transferIds.length) {
          this.notFound(
            'WAREHOUSE_TRANSFER_NOT_FOUND',
            'One or more recommended warehouse transfers were not found',
          );
        }
        let manifestWeightGrams = 0;
        for (const transfer of transfers) {
          this.transferLifecycle.assertDispatchableTransfer(transfer, {
            originWarehouseId: dto.originWarehouseId,
            destinationWarehouseId: dto.destinationWarehouseId,
          });
          if (transfer.lineHaulTripAssignments.length > 0) this.transferOwnershipConflict();
          manifestWeightGrams += resolveShipmentLoadWeightGrams(transfer.shipment.packageSnapshot);
        }
        assertManifestWithinCapacity(manifestWeightGrams, vehicle.capacityWeightGrams);

        const created = await transaction.lineHaulTrip.create({
          data: {
            tripCode: this.generateTripCode(),
            clientRequestId: dto.clientRequestId,
            originWarehouseId: dto.originWarehouseId,
            destinationWarehouseId: dto.destinationWarehouseId,
            driverId: driver.id,
            vehicleId: vehicle.id,
            plannedDepartureAt: dto.plannedDepartureAt
              ? new Date(dto.plannedDepartureAt)
              : (scheduleWindow?.start ?? null),
            scheduledStartAt: scheduleWindow?.start ?? null,
            scheduledEndAt: scheduleWindow?.end ?? null,
            createdById: actor.id,
            ...(transferIds.length > 0
              ? {
                  transferAssignments: {
                    create: transferIds.map((warehouseTransferId) => ({
                      warehouseTransferId,
                      assignedById: actor.id,
                    })),
                  },
                }
              : {}),
          },
          include: lineHaulTripInclude,
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_TRIP_CREATED',
            entityType: 'LineHaulTrip',
            entityId: created.id,
            after: {
              tripCode: created.tripCode,
              originWarehouseId: created.originWarehouseId,
              destinationWarehouseId: created.destinationWarehouseId,
              driverId: created.driverId,
              vehicleId: created.vehicleId,
              status: created.status,
              plannedDepartureAt: created.plannedDepartureAt,
              scheduledStartAt: created.scheduledStartAt,
              scheduledEndAt: created.scheduledEndAt,
              warehouseTransferIds: transferIds,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        for (const assignment of created.transferAssignments.filter(
          (candidate) => candidate.isActive,
        )) {
          await transaction.auditLog.create({
            data: {
              actorId: actor.id,
              actorRole: actor.role,
              action: 'LINE_HAUL_TRANSFER_ASSIGNED',
              entityType: 'LineHaulTripTransfer',
              entityId: assignment.id,
              after: {
                tripId: created.id,
                warehouseTransferId: assignment.warehouseTransferId,
                isActive: true,
              },
              metadata: {
                source: 'PLANNING_RECOMMENDATION_REVIEW',
                manifestWeightGrams,
                vehicleCapacityWeightGrams: vehicle.capacityWeightGrams,
              },
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            },
          });
        }
        return created;
      });
      return this.toResponse(trip, actor);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2004') this.scheduleResourceConflict();
        if (error.code === 'P2002' || error.code === 'P2034') {
          return this.resolveCreateConflict(actor, dto);
        }
      }
      throw error;
    }
  }

  async list(actor: AuthenticatedUser, query: ListLineHaulTripsDto) {
    const search = query.search?.trim();
    const staffWarehouseId = await this.resolveStaffWarehouseId(actor);
    const scheduledRange = this.resolveListScheduleRange(query);
    const where: Prisma.LineHaulTripWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.originWarehouseId ? { originWarehouseId: query.originWarehouseId } : {}),
      ...(query.destinationWarehouseId
        ? { destinationWarehouseId: query.destinationWarehouseId }
        : {}),
      ...(scheduledRange
        ? {
            scheduledStartAt: { lt: scheduledRange.end },
            scheduledEndAt: { gt: scheduledRange.start },
          }
        : {}),
      ...(staffWarehouseId
        ? {
            OR: [
              { originWarehouseId: staffWarehouseId },
              { destinationWarehouseId: staffWarehouseId },
            ],
          }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { tripCode: { contains: search, mode: 'insensitive' } },
                  { driver: { employeeCode: { contains: search, mode: 'insensitive' } } },
                  { driver: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
                  { vehicle: { vehicleCode: { contains: search, mode: 'insensitive' } } },
                  { vehicle: { licensePlate: { contains: search, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.lineHaulTrip.findMany({
        where,
        include: lineHaulTripInclude,
        orderBy: [
          { scheduledStartAt: { sort: 'asc', nulls: 'last' } },
          { plannedDepartureAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.lineHaulTrip.count({ where }),
    ]);
    return {
      items: items.map((trip) => this.toResponse(trip, actor, staffWarehouseId)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async get(actor: AuthenticatedUser, id: string) {
    const trip = await this.prisma.lineHaulTrip.findUnique({
      where: { id },
      include: lineHaulTripInclude,
    });
    if (!trip) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
    const staffWarehouseId = await this.resolveStaffWarehouseId(actor);
    if (
      staffWarehouseId &&
      trip.originWarehouseId !== staffWarehouseId &&
      trip.destinationWarehouseId !== staffWarehouseId
    ) {
      throw new ForbiddenException({
        code: 'LINE_HAUL_WAREHOUSE_SCOPE_FORBIDDEN',
        message: 'Trip is outside the assigned warehouse scope',
      });
    }
    const [remainingRoute, routeHistory] = await Promise.all([
      this.remainingRoute(actor, trip),
      this.prisma.lineHaulTripRoute.findMany({
        where: { tripId: id },
        select: lineHaulTripRouteSelect,
        orderBy: { version: 'asc' },
      }),
    ]);
    return this.toResponse(trip, actor, staffWarehouseId, remainingRoute, routeHistory);
  }

  async listEligibleDrivers(query: ListEligibleLineHaulResourcesDto) {
    const search = query.search?.trim();
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        status: { not: DriverStatus.SUSPENDED },
        capabilities: { has: DriverCapability.LINE_HAUL },
        user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        ...(search
          ? {
              OR: [
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { fullName: true } } },
      orderBy: { employeeCode: 'asc' },
      take: query.limit,
    });
    return drivers.map((driver) => ({
      id: driver.id,
      fullName: driver.user.fullName,
      employeeCode: driver.employeeCode,
      status: driver.status,
      capabilities: driver.capabilities,
    }));
  }

  async listEligibleVehicles(query: ListEligibleLineHaulResourcesDto) {
    const search = query.search?.trim();
    const vehicles = await this.prisma.lineHaulVehicle.findMany({
      where: {
        status: LineHaulVehicleStatus.AVAILABLE,
        capacityWeightGrams: { gt: 0, lte: MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS },
        ...(search
          ? {
              OR: [
                { vehicleCode: { contains: search, mode: 'insensitive' } },
                { licensePlate: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { vehicleCode: 'asc' },
      take: query.limit,
    });
    return vehicles.map(toLineHaulVehicleResponse);
  }

  async resourceAvailability(query: LineHaulResourceAvailabilityDto) {
    const window = this.parseScheduleWindow(query.scheduledStartAt, query.scheduledEndAt);
    const search = query.search?.trim();
    const [drivers, vehicles] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where: {
          capabilities: { has: DriverCapability.LINE_HAUL },
          user: { role: UserRole.DRIVER },
          ...(search
            ? {
                OR: [
                  { employeeCode: { contains: search, mode: 'insensitive' as const } },
                  { user: { fullName: { contains: search, mode: 'insensitive' as const } } },
                ],
              }
            : {}),
        },
        include: { user: { select: { fullName: true, status: true } } },
        orderBy: { employeeCode: 'asc' },
        take: query.limit,
      }),
      this.prisma.lineHaulVehicle.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { vehicleCode: { contains: search, mode: 'insensitive' as const } },
                  { licensePlate: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: { vehicleCode: 'asc' },
        take: query.limit,
      }),
    ]);
    const resourceFilters: Prisma.LineHaulTripWhereInput[] = [];
    if (drivers.length > 0) resourceFilters.push({ driverId: { in: drivers.map(({ id }) => id) } });
    if (vehicles.length > 0)
      resourceFilters.push({ vehicleId: { in: vehicles.map(({ id }) => id) } });
    const conflicts =
      resourceFilters.length === 0
        ? []
        : await this.prisma.lineHaulTrip.findMany({
            where: {
              AND: [
                this.scheduleConflictWhere(window.start, window.end, query.tripId),
                { OR: resourceFilters },
              ],
            },
            select: {
              id: true,
              tripCode: true,
              driverId: true,
              vehicleId: true,
              status: true,
              scheduledStartAt: true,
              scheduledEndAt: true,
            },
            orderBy: [{ scheduledStartAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
          });
    const toConflict = (conflict: (typeof conflicts)[number]) => ({
      tripId: conflict.id,
      tripCode: conflict.tripCode,
      status: conflict.status,
      scheduledStartAt: conflict.scheduledStartAt,
      scheduledEndAt: conflict.scheduledEndAt,
    });
    return {
      scheduledStartAt: window.start,
      scheduledEndAt: window.end,
      drivers: drivers.map((driver) => {
        const resourceConflicts = conflicts
          .filter((conflict) => conflict.driverId === driver.id)
          .map(toConflict);
        const unavailable =
          driver.user.status !== UserStatus.ACTIVE || driver.status === DriverStatus.SUSPENDED;
        return {
          id: driver.id,
          fullName: driver.user.fullName,
          employeeCode: driver.employeeCode,
          status: driver.status,
          availability: unavailable
            ? ('UNAVAILABLE' as const)
            : resourceConflicts.length > 0
              ? ('BUSY' as const)
              : ('AVAILABLE' as const),
          unavailableReason: unavailable ? 'Tài xế đang bị tạm ngưng' : null,
          conflicts: resourceConflicts,
        };
      }),
      vehicles: vehicles.map((vehicle) => {
        const resourceConflicts = conflicts
          .filter((conflict) => conflict.vehicleId === vehicle.id)
          .map(toConflict);
        const capacityValid =
          vehicle.capacityWeightGrams !== null &&
          vehicle.capacityWeightGrams > 0 &&
          vehicle.capacityWeightGrams <= MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS;
        const unavailable = vehicle.status !== LineHaulVehicleStatus.AVAILABLE || !capacityValid;
        return {
          ...toLineHaulVehicleResponse(vehicle),
          availability: unavailable
            ? ('UNAVAILABLE' as const)
            : resourceConflicts.length > 0
              ? ('BUSY' as const)
              : ('AVAILABLE' as const),
          unavailableReason: !capacityValid
            ? 'Xe chưa có sức tải hợp lệ'
            : vehicle.status !== LineHaulVehicleStatus.AVAILABLE
              ? 'Xe không ở trạng thái sẵn sàng'
              : null,
          conflicts: resourceConflicts,
        };
      }),
    };
  }

  async listEligibleTransfers(id: string, query: ListEligibleLineHaulResourcesDto) {
    const trip = await this.prisma.lineHaulTrip.findUnique({
      where: { id },
      include: {
        vehicle: true,
        transferAssignments: {
          where: { isActive: true },
          include: {
            warehouseTransfer: {
              include: { shipment: { select: { packageSnapshot: true } } },
            },
          },
        },
      },
    });
    if (!trip) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
    this.policy.assertTripConfigurable(trip.status);
    this.policy.assertVehicleEligible(trip.vehicle);
    const manifestWeightGrams = calculateManifestWeightGrams(trip.transferAssignments);
    const vehicleCapacityWeightGrams = trip.vehicle.capacityWeightGrams;
    assertManifestWithinCapacity(manifestWeightGrams, vehicleCapacityWeightGrams);
    const search = query.search?.trim();
    const transfers = await this.prisma.warehouseTransfer.findMany({
      where: {
        fromWarehouseId: trip.originWarehouseId,
        toWarehouseId: trip.destinationWarehouseId,
        status: WarehouseTransferStatus.PENDING,
        lineHaulTripAssignments: { none: { isActive: true } },
        ...(search
          ? {
              OR: [
                { transferCode: { contains: search, mode: 'insensitive' } },
                { shipment: { trackingCode: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        shipment: {
          select: { id: true, trackingCode: true, status: true, packageSnapshot: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: query.limit,
    });
    return transfers.map((transfer) => {
      const loadWeightGrams = resolveShipmentLoadWeightGrams(transfer.shipment.packageSnapshot);
      const projectedManifestWeightGrams = manifestWeightGrams + loadWeightGrams;
      return {
        id: transfer.id,
        transferCode: transfer.transferCode,
        status: transfer.status,
        loadWeightGrams,
        projectedManifestWeightGrams,
        remainingCapacityAfterAddGrams: vehicleCapacityWeightGrams - projectedManifestWeightGrams,
        fitsVehicleCapacity: projectedManifestWeightGrams <= vehicleCapacityWeightGrams,
        shipment: {
          id: transfer.shipment.id,
          trackingCode: transfer.shipment.trackingCode,
          status: transfer.shipment.status,
        },
      };
    });
  }

  async assignTransfer(
    actor: AuthenticatedUser,
    id: string,
    dto: AssignLineHaulTransferDto,
    context: ClientContext,
  ) {
    try {
      const trip = await this.prisma.$transaction(async (transaction) => {
        await this.lockTrip(transaction, id);
        await this.lockTransfer(transaction, dto.transferId);
        const current = await transaction.lineHaulTrip.findUnique({
          where: { id },
          include: lineHaulTripInclude,
        });
        if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
        this.policy.assertTripConfigurable(current.status);
        const transfer = await transaction.warehouseTransfer.findUnique({
          where: { id: dto.transferId },
          include: { shipment: { select: { packageSnapshot: true } } },
        });
        if (!transfer) {
          this.notFound('WAREHOUSE_TRANSFER_NOT_FOUND', 'Warehouse transfer was not found');
        }
        this.policy.assertTransferMatchesTrip(transfer, current);
        const activeAssignment = await transaction.lineHaulTripTransfer.findFirst({
          where: { warehouseTransferId: transfer.id, isActive: true },
        });
        if (activeAssignment) {
          if (activeAssignment.tripId === current.id) {
            return transaction.lineHaulTrip.findUniqueOrThrow({
              where: { id },
              include: lineHaulTripInclude,
            });
          }
          this.transferOwnershipConflict();
        }
        const currentManifestWeightGrams = calculateManifestWeightGrams(
          current.transferAssignments,
        );
        const transferWeightGrams = resolveShipmentLoadWeightGrams(
          transfer.shipment.packageSnapshot,
        );
        assertManifestWithinCapacity(
          currentManifestWeightGrams + transferWeightGrams,
          current.vehicle.capacityWeightGrams,
        );
        const assignment = await transaction.lineHaulTripTransfer.create({
          data: {
            tripId: current.id,
            warehouseTransferId: transfer.id,
            assignedById: actor.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_TRANSFER_ASSIGNED',
            entityType: 'LineHaulTripTransfer',
            entityId: assignment.id,
            after: { tripId: current.id, warehouseTransferId: transfer.id, isActive: true },
            metadata: {
              transferWeightGrams,
              manifestWeightGrams: currentManifestWeightGrams + transferWeightGrams,
              vehicleCapacityWeightGrams: current.vehicle.capacityWeightGrams,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        });
      });
      return this.toResponse(trip, actor);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const active = await this.prisma.lineHaulTripTransfer.findFirst({
          where: { warehouseTransferId: dto.transferId, isActive: true },
        });
        if (active?.tripId === id) return this.get(actor, id);
        this.transferOwnershipConflict();
      }
      throw error;
    }
  }

  async removeTransfer(
    actor: AuthenticatedUser,
    id: string,
    transferId: string,
    context: ClientContext,
  ) {
    const trip = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      const current = await transaction.lineHaulTrip.findUnique({ where: { id } });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      this.policy.assertTripConfigurable(current.status);
      const assignment = await transaction.lineHaulTripTransfer.findFirst({
        where: { tripId: id, warehouseTransferId: transferId, isActive: true },
      });
      if (!assignment) {
        const historical = await transaction.lineHaulTripTransfer.findFirst({
          where: { tripId: id, warehouseTransferId: transferId },
        });
        if (!historical) {
          this.notFound(
            'LINE_HAUL_TRANSFER_ASSIGNMENT_NOT_FOUND',
            'Transfer is not assigned to this trip',
          );
        }
        return transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        });
      }
      const now = new Date();
      const update = await transaction.lineHaulTripTransfer.updateMany({
        where: { id: assignment.id, isActive: true },
        data: { isActive: false, removedAt: now, removedById: actor.id },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_TRANSFER_CONCURRENT_MODIFICATION',
          message: 'Transfer assignment changed concurrently; reload and try again',
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_TRANSFER_REMOVED',
          entityType: 'LineHaulTripTransfer',
          entityId: assignment.id,
          before: { tripId: id, warehouseTransferId: transferId, isActive: true },
          after: { tripId: id, warehouseTransferId: transferId, isActive: false },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
    });
    return this.toResponse(trip, actor);
  }

  schedule(
    actor: AuthenticatedUser,
    id: string,
    dto: ScheduleLineHaulTripDto,
    context: ClientContext,
  ) {
    return this.setSchedule(actor, id, dto, context, 'SCHEDULE');
  }

  reschedule(
    actor: AuthenticatedUser,
    id: string,
    dto: ScheduleLineHaulTripDto,
    context: ClientContext,
  ) {
    return this.setSchedule(actor, id, dto, context, 'RESCHEDULE');
  }

  async unschedule(
    actor: AuthenticatedUser,
    id: string,
    dto: UnscheduleLineHaulTripDto,
    context: ClientContext,
  ) {
    const trip = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      const current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        include: lineHaulTripInclude,
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      this.policy.assertTripSchedulable(current.status);
      if (current.scheduledStartAt === null && current.scheduledEndAt === null) return current;
      this.assertExpectedVersion(current.version, dto.expectedVersion);
      const update = await transaction.lineHaulTrip.updateMany({
        where: { id, status: LineHaulTripStatus.PLANNED, version: current.version },
        data: {
          scheduledStartAt: null,
          scheduledEndAt: null,
          version: { increment: 1 },
        },
      });
      this.assertTripUpdated(update.count);
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_TRIP_UNSCHEDULED',
          entityType: 'LineHaulTrip',
          entityId: id,
          before: {
            scheduledStartAt: current.scheduledStartAt,
            scheduledEndAt: current.scheduledEndAt,
            version: current.version,
          },
          after: {
            scheduledStartAt: null,
            scheduledEndAt: null,
            version: current.version + 1,
          },
          metadata: { driverId: current.driverId, vehicleId: current.vehicleId },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
    });
    return this.toResponse(trip, actor);
  }

  async prepare(actor: AuthenticatedUser, id: string, context: ClientContext) {
    const plannedRoute = await this.plannedRoute(id);
    const trip = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      let current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        include: lineHaulTripInclude,
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      if (
        current.status === LineHaulTripStatus.READY ||
        current.status === LineHaulTripStatus.IN_TRANSIT ||
        current.status === LineHaulTripStatus.ARRIVED
      ) {
        return current;
      }
      this.policy.assertTripPrepareable(current.status);
      await this.lockExecutionResources(transaction, current);
      current = await transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
      const capacity = await this.assertExecutionReady(transaction, current);

      const origin = this.warehousePoint(current.originWarehouse);
      const destination = this.warehousePoint(current.destinationWarehouse);
      const plannedRouteVersion =
        plannedRoute && origin && destination
          ? await transaction.lineHaulTripRoute.create({
              data: {
                tripId: id,
                version: 1,
                type: 'PLANNED',
                startLatitude: origin.latitude,
                startLongitude: origin.longitude,
                destinationLatitude: destination.latitude,
                destinationLongitude: destination.longitude,
                distanceMeters: plannedRoute.distanceMeters,
                durationSeconds: plannedRoute.durationSeconds,
                metricMode:
                  plannedRoute.mode === 'ROAD_ROUTE'
                    ? RouteMetricMode.ROAD_ROUTE
                    : RouteMetricMode.HAVERSINE_FALLBACK,
                provider: plannedRoute.provider,
                ...(plannedRoute.geometry
                  ? { geometry: plannedRoute.geometry as unknown as Prisma.InputJsonValue }
                  : {}),
                calculatedAt: plannedRoute.calculatedAt,
                createdById: actor.id,
              },
            })
          : null;

      const update = await transaction.lineHaulTrip.updateMany({
        where: { id, status: LineHaulTripStatus.PLANNED, version: current.version },
        data: {
          status: LineHaulTripStatus.READY,
          ...(plannedRoute
            ? {
                plannedDistanceMeters: plannedRoute.distanceMeters,
                plannedDurationSeconds: plannedRoute.durationSeconds,
                routeMetricMode:
                  plannedRoute.mode === 'ROAD_ROUTE'
                    ? RouteMetricMode.ROAD_ROUTE
                    : RouteMetricMode.HAVERSINE_FALLBACK,
                routeProvider: plannedRoute.provider,
                routeCalculatedAt: plannedRoute.calculatedAt,
              }
            : {}),
          ...(plannedRouteVersion ? { currentRouteId: plannedRouteVersion.id } : {}),
          preparedManifestWeightGrams: capacity.manifestWeightGrams,
          preparedVehicleCapacityWeightGrams: capacity.vehicleCapacityWeightGrams,
          version: { increment: 1 },
        },
      });
      this.assertTripUpdated(update.count);
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_TRIP_READY',
          entityType: 'LineHaulTrip',
          entityId: id,
          before: { status: current.status, version: current.version },
          after: {
            status: LineHaulTripStatus.READY,
            version: current.version + 1,
            plannedRoute: plannedRoute
              ? {
                  distanceMeters: plannedRoute.distanceMeters,
                  durationSeconds: plannedRoute.durationSeconds,
                  mode: plannedRoute.mode,
                  provider: plannedRoute.provider,
                  calculatedAt: plannedRoute.calculatedAt,
                }
              : null,
            preparedManifestWeightGrams: capacity.manifestWeightGrams,
            preparedVehicleCapacityWeightGrams: capacity.vehicleCapacityWeightGrams,
          },
          metadata: {
            manifestTransferIds: this.activeAssignments(current).map(
              (assignment) => assignment.warehouseTransferId,
            ),
            manifestWeightGrams: capacity.manifestWeightGrams,
            vehicleCapacityWeightGrams: capacity.vehicleCapacityWeightGrams,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
    });
    return this.get(actor, trip.id);
  }

  async dispatch(actor: AuthenticatedUser, id: string, context: ClientContext) {
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      let current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        include: lineHaulTripInclude,
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      if (
        current.status === LineHaulTripStatus.IN_TRANSIT ||
        current.status === LineHaulTripStatus.ARRIVED
      ) {
        return { trip: current, transitionedShipmentIds: [] as string[] };
      }
      this.policy.assertTripDispatchable(current.status);
      await this.lockExecutionResources(transaction, current);
      current = await transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
      await this.assertExecutionReady(transaction, current);

      const departedAt = new Date();
      const tripUpdate = await transaction.lineHaulTrip.updateMany({
        where: { id, status: LineHaulTripStatus.READY, version: current.version },
        data: {
          status: LineHaulTripStatus.IN_TRANSIT,
          departedAt,
          version: { increment: 1 },
        },
      });
      this.assertTripUpdated(tripUpdate.count);
      const vehicleUpdate = await transaction.lineHaulVehicle.updateMany({
        where: {
          id: current.vehicle.id,
          status: LineHaulVehicleStatus.AVAILABLE,
          version: current.vehicle.version,
        },
        data: { status: LineHaulVehicleStatus.IN_USE, version: { increment: 1 } },
      });
      if (vehicleUpdate.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_CONCURRENT_MODIFICATION',
          message: 'Vehicle changed concurrently; reload and try again',
        });
      }

      const transitionedShipmentIds: string[] = [];
      for (const assignment of this.activeAssignments(current)) {
        const transition = await this.transferLifecycle.dispatch(transaction, {
          warehouseId: current.originWarehouseId,
          transferId: assignment.warehouseTransferId,
          actor,
          context,
          lineHaulTripId: current.id,
        });
        if (transition.transitioned) transitionedShipmentIds.push(transition.transfer.shipmentId);
      }

      await transaction.auditLog.createMany({
        data: [
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_TRIP_DISPATCHED',
            entityType: 'LineHaulTrip',
            entityId: id,
            before: { status: current.status, version: current.version },
            after: {
              status: LineHaulTripStatus.IN_TRANSIT,
              departedAt,
              version: current.version + 1,
            },
            metadata: {
              manifestTransferIds: this.activeAssignments(current).map(
                (assignment) => assignment.warehouseTransferId,
              ),
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_VEHICLE_IN_USE',
            entityType: 'LineHaulVehicle',
            entityId: current.vehicleId,
            before: { status: current.vehicle.status, version: current.vehicle.version },
            after: {
              status: LineHaulVehicleStatus.IN_USE,
              version: current.vehicle.version + 1,
              tripId: id,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        ],
      });
      return {
        trip: await transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        }),
        transitionedShipmentIds,
      };
    });

    await Promise.all(
      result.transitionedShipmentIds.map((shipmentId) =>
        this.notifications.publishShipmentUpdated(shipmentId, ShipmentStatus.IN_TRANSIT),
      ),
    );
    return this.get(actor, result.trip.id);
  }

  async arrive(actor: AuthenticatedUser, id: string, context: ClientContext) {
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      const current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        include: lineHaulTripInclude,
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      await this.assertDestinationConfirmationAccess(
        transaction,
        actor,
        current.destinationWarehouseId,
      );
      if (current.status === LineHaulTripStatus.ARRIVED) {
        return { trip: current, transitioned: false };
      }
      this.policy.assertTripArrivable(current.status);
      await this.lockVehicle(transaction, current.vehicleId);
      const activeAssignments = this.activeAssignments(current);
      if (activeAssignments.length === 0) {
        throw new ConflictException({
          code: 'LINE_HAUL_MANIFEST_EMPTY',
          message: 'An in-transit trip must retain its manifest history',
        });
      }
      const arrivedAt = new Date();
      const tripUpdate = await transaction.lineHaulTrip.updateMany({
        where: { id, status: LineHaulTripStatus.IN_TRANSIT, version: current.version },
        data: {
          status: LineHaulTripStatus.ARRIVED,
          arrivedAt,
          version: { increment: 1 },
        },
      });
      this.assertTripUpdated(tripUpdate.count);
      const vehicleUpdate = await transaction.lineHaulVehicle.updateMany({
        where: {
          id: current.vehicleId,
          status: LineHaulVehicleStatus.IN_USE,
          version: current.vehicle.version,
        },
        data: { status: LineHaulVehicleStatus.AVAILABLE, version: { increment: 1 } },
      });
      if (vehicleUpdate.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_CONCURRENT_MODIFICATION',
          message: 'Vehicle changed concurrently; reload and try again',
        });
      }
      await transaction.trackingEvent.createMany({
        data: activeAssignments.map((assignment) => ({
          shipmentId: assignment.warehouseTransfer.shipmentId,
          status: ShipmentStatus.IN_TRANSIT,
          type: 'LINE_HAUL_TRIP_ARRIVED',
          title: 'Xe đã đến kho đích',
          description: `Chuyến ${current.tripCode} đã đến ${current.destinationWarehouse.name}; kiện hàng đang chờ kho xác nhận tiếp nhận.`,
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
          warehouseId: current.destinationWarehouseId,
          createdAt: arrivedAt,
        })),
      });
      await transaction.auditLog.createMany({
        data: [
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_TRIP_ARRIVED',
            entityType: 'LineHaulTrip',
            entityId: id,
            before: { status: current.status, version: current.version },
            after: {
              status: LineHaulTripStatus.ARRIVED,
              arrivedAt,
              version: current.version + 1,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_VEHICLE_RELEASED',
            entityType: 'LineHaulVehicle',
            entityId: current.vehicleId,
            before: { status: current.vehicle.status, version: current.vehicle.version },
            after: {
              status: LineHaulVehicleStatus.AVAILABLE,
              version: current.vehicle.version + 1,
              tripId: id,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        ],
      });
      return {
        trip: await transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        }),
        transitioned: true,
      };
    });
    if (result.transitioned && result.trip.arrivedAt) {
      await this.locations.endLineHaulTripTracking(id, result.trip.arrivedAt);
    }
    return this.get(actor, result.trip.id);
  }

  async recalculateRoute(actor: AuthenticatedUser, id: string, context: ClientContext) {
    this.assertRerouteActor(actor);
    if (!this.routes.roadProviderEnabled) {
      throw new ServiceUnavailableException({
        code: 'LINE_HAUL_REROUTE_PROVIDER_UNAVAILABLE',
        message: 'Road-route recalculation is not configured',
      });
    }

    const preflight = await this.prisma.lineHaulTrip.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        version: true,
        currentRouteId: true,
        destinationWarehouseId: true,
        destinationWarehouse: { select: { latitude: true, longitude: true } },
        currentRoute: { select: { version: true } },
      },
    });
    if (!preflight) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
    if (preflight.status !== LineHaulTripStatus.IN_TRANSIT) {
      throw new ConflictException({
        code: 'LINE_HAUL_REROUTE_NOT_IN_TRANSIT',
        message: 'A route can be recalculated only while the trip is in transit',
      });
    }
    if (!preflight.currentRouteId || !preflight.currentRoute) {
      throw new ConflictException({
        code: 'LINE_HAUL_CURRENT_ROUTE_REQUIRED',
        message: 'The trip has no authoritative route version to recalculate',
      });
    }
    const previousRouteVersion = preflight.currentRoute.version;
    const destination = this.warehousePoint(preflight.destinationWarehouse);
    if (!destination) {
      throw new ConflictException({
        code: 'LINE_HAUL_DESTINATION_LOCATION_REQUIRED',
        message: 'The destination warehouse needs valid coordinates for rerouting',
      });
    }
    const locationState = await this.locations.getLineHaulTripLocation(actor, id);
    if (locationState.locationState !== 'CURRENT' || !locationState.location) {
      throw new ConflictException({
        code: 'LINE_HAUL_CURRENT_GPS_REQUIRED',
        message: 'A current line-haul GPS sample is required for rerouting',
      });
    }
    const start: RoutePoint = {
      latitude: locationState.location.latitude,
      longitude: locationState.location.longitude,
    };
    const capturedAt = locationState.location.capturedAt;

    // The external provider call intentionally happens before the short commit transaction.
    const calculated = await this.routes.calculateRoadRouteWithGeometry({
      origin: start,
      destination,
    });
    if (!calculated || calculated.mode !== 'ROAD_ROUTE' || !calculated.geometry) {
      throw new ServiceUnavailableException({
        code: 'LINE_HAUL_REROUTE_PROVIDER_UNAVAILABLE',
        message: 'Road-route geometry could not be calculated; the current route is unchanged',
      });
    }

    const route = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      this.assertRerouteActor(actor);
      const current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        select: {
          status: true,
          version: true,
          destinationWarehouseId: true,
          destinationWarehouse: { select: { latitude: true, longitude: true } },
          currentRouteId: true,
          currentRoute: { select: { version: true } },
        },
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      if (current.status !== LineHaulTripStatus.IN_TRANSIT) {
        throw new ConflictException({
          code: 'LINE_HAUL_REROUTE_NOT_IN_TRANSIT',
          message: 'Trip left IN_TRANSIT while the route was being calculated',
        });
      }
      if (
        current.version !== preflight.version ||
        current.currentRouteId !== preflight.currentRouteId ||
        current.destinationWarehouseId !== preflight.destinationWarehouseId ||
        !current.currentRoute
      ) {
        throw new ConflictException({
          code: 'LINE_HAUL_REROUTE_CONCURRENT_MODIFICATION',
          message: 'Trip or route changed concurrently; reload before recalculating again',
        });
      }
      const currentDestination = this.warehousePoint(current.destinationWarehouse);
      if (
        !currentDestination ||
        currentDestination.latitude !== destination.latitude ||
        currentDestination.longitude !== destination.longitude
      ) {
        throw new ConflictException({
          code: 'LINE_HAUL_REROUTE_DESTINATION_CHANGED',
          message: 'Destination coordinates changed while the route was being calculated',
        });
      }
      const capturedTime = Date.parse(capturedAt);
      if (
        !Number.isFinite(capturedTime) ||
        Date.now() - capturedTime < 0 ||
        Date.now() - capturedTime >= LOCATION_TTL_MILLISECONDS
      ) {
        throw new ConflictException({
          code: 'LINE_HAUL_CURRENT_GPS_REQUIRED',
          message: 'The GPS sample became stale while the route was being calculated',
        });
      }

      const created = await transaction.lineHaulTripRoute.create({
        data: {
          tripId: id,
          version: current.currentRoute.version + 1,
          type: 'REROUTE',
          startLatitude: start.latitude,
          startLongitude: start.longitude,
          destinationLatitude: destination.latitude,
          destinationLongitude: destination.longitude,
          distanceMeters: calculated.distanceMeters,
          durationSeconds: calculated.durationSeconds,
          metricMode: RouteMetricMode.ROAD_ROUTE,
          provider: calculated.provider,
          geometry: calculated.geometry as unknown as Prisma.InputJsonValue,
          calculatedAt: calculated.calculatedAt,
          createdById: actor.id,
        },
      });
      const updated = await transaction.lineHaulTrip.updateMany({
        where: {
          id,
          status: LineHaulTripStatus.IN_TRANSIT,
          version: preflight.version,
          currentRouteId: preflight.currentRouteId,
        },
        data: { currentRouteId: created.id, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_REROUTE_CONCURRENT_MODIFICATION',
          message: 'Another command changed the trip before the route could be committed',
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_ROUTE_RECALCULATED',
          entityType: 'LineHaulTripRoute',
          entityId: created.id,
          before: {
            tripId: id,
            routeId: preflight.currentRouteId,
            routeVersion: previousRouteVersion,
          },
          after: {
            tripId: id,
            routeId: created.id,
            routeVersion: created.version,
            start,
            destination,
            distanceMeters: created.distanceMeters,
            durationSeconds: created.durationSeconds,
          } as unknown as Prisma.InputJsonValue,
          metadata: { gpsCapturedAt: capturedAt },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return created;
    });

    const calculatedAt = route.calculatedAt.toISOString();
    await this.routeDeviation.announceRouteReset(
      id,
      previousRouteVersion,
      route.version,
      calculatedAt,
    );
    await this.gateway.emitLineHaulRouteUpdated({
      tripId: id,
      routeVersion: route.version,
      calculatedAt,
    });
    return this.get(actor, id);
  }

  async cancel(
    actor: AuthenticatedUser,
    id: string,
    dto: CancelLineHaulTripDto,
    context: ClientContext,
  ) {
    const trip = await this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, id);
      const current = await transaction.lineHaulTrip.findUnique({
        where: { id },
        include: lineHaulTripInclude,
      });
      if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      if (current.status === LineHaulTripStatus.CANCELLED) return current;
      this.policy.assertTripCancellable(current.status);
      const now = new Date();
      const update = await transaction.lineHaulTrip.updateMany({
        where: { id, status: current.status, version: current.version },
        data: {
          status: LineHaulTripStatus.CANCELLED,
          cancellationReason: dto.reason.trim(),
          cancelledAt: now,
          cancelledById: actor.id,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_TRIP_CONCURRENT_MODIFICATION',
          message: 'Trip changed concurrently; reload and try again',
        });
      }
      await transaction.lineHaulTripTransfer.updateMany({
        where: { tripId: id, isActive: true },
        data: { isActive: false, removedAt: now, removedById: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_TRIP_CANCELLED',
          entityType: 'LineHaulTrip',
          entityId: id,
          before: { status: current.status, version: current.version },
          after: {
            status: LineHaulTripStatus.CANCELLED,
            cancellationReason: dto.reason.trim(),
            version: current.version + 1,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return transaction.lineHaulTrip.findUniqueOrThrow({
        where: { id },
        include: lineHaulTripInclude,
      });
    });
    return this.toResponse(trip, actor);
  }

  private async setSchedule(
    actor: AuthenticatedUser,
    id: string,
    dto: ScheduleLineHaulTripDto,
    context: ClientContext,
    command: 'SCHEDULE' | 'RESCHEDULE',
  ) {
    const window = this.parseScheduleWindow(dto.scheduledStartAt, dto.scheduledEndAt);
    try {
      const trip = await this.prisma.$transaction(async (transaction) => {
        await this.lockTrip(transaction, id);
        let current = await transaction.lineHaulTrip.findUnique({
          where: { id },
          include: lineHaulTripInclude,
        });
        if (!current) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
        this.policy.assertTripSchedulable(current.status);
        const hasSchedule = current.scheduledStartAt !== null && current.scheduledEndAt !== null;
        const sameWindow =
          current.scheduledStartAt?.getTime() === window.start.getTime() &&
          current.scheduledEndAt?.getTime() === window.end.getTime();
        if (sameWindow) return current;
        if (command === 'SCHEDULE' && hasSchedule) {
          throw new ConflictException({
            code: 'LINE_HAUL_TRIP_ALREADY_SCHEDULED',
            message: 'Trip already has a schedule; use the reschedule command',
          });
        }
        if (command === 'RESCHEDULE' && !hasSchedule) {
          throw new ConflictException({
            code: 'LINE_HAUL_TRIP_NOT_SCHEDULED',
            message: 'Trip has no schedule; use the schedule command',
          });
        }
        this.assertExpectedVersion(current.version, dto.expectedVersion);
        await this.driverOwnership.lock(transaction, current.driverId);
        await this.lockVehicle(transaction, current.vehicleId);
        current = await transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        });
        this.policy.assertTripSchedulable(current.status);
        this.policy.assertDriverEligible(current.driver);
        this.policy.assertVehicleEligible(current.vehicle);
        await this.assertScheduleResourcesAvailable(transaction, current, window.start, window.end);

        const update = await transaction.lineHaulTrip.updateMany({
          where: { id, status: LineHaulTripStatus.PLANNED, version: current.version },
          data: {
            scheduledStartAt: window.start,
            scheduledEndAt: window.end,
            version: { increment: 1 },
          },
        });
        this.assertTripUpdated(update.count);
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action:
              command === 'SCHEDULE' ? 'LINE_HAUL_TRIP_SCHEDULED' : 'LINE_HAUL_TRIP_RESCHEDULED',
            entityType: 'LineHaulTrip',
            entityId: id,
            before: {
              scheduledStartAt: current.scheduledStartAt,
              scheduledEndAt: current.scheduledEndAt,
              version: current.version,
            },
            after: {
              scheduledStartAt: window.start,
              scheduledEndAt: window.end,
              version: current.version + 1,
            },
            metadata: { driverId: current.driverId, vehicleId: current.vehicleId },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return transaction.lineHaulTrip.findUniqueOrThrow({
          where: { id },
          include: lineHaulTripInclude,
        });
      });
      return this.toResponse(trip, actor);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2004')
      ) {
        this.scheduleResourceConflict();
      }
      throw error;
    }
  }

  private async assertScheduleResourcesAvailable(
    transaction: Prisma.TransactionClient,
    trip: LineHaulTripRecord,
    start: Date,
    end: Date,
  ): Promise<void> {
    return this.assertScheduleResourcesAvailableByIds(
      transaction,
      trip.driverId,
      trip.vehicleId,
      start,
      end,
      trip.id,
    );
  }

  private async assertScheduleResourcesAvailableByIds(
    transaction: Prisma.TransactionClient,
    driverId: string,
    vehicleId: string,
    start: Date,
    end: Date,
    excludedTripId?: string,
  ): Promise<void> {
    const where = this.scheduleConflictWhere(start, end, excludedTripId);
    const driverConflict = await transaction.lineHaulTrip.findFirst({
      where: { AND: [where, { driverId }] },
      select: { id: true },
    });
    if (driverConflict) this.driverScheduleConflict();
    const vehicleConflict = await transaction.lineHaulTrip.findFirst({
      where: { AND: [where, { vehicleId }] },
      select: { id: true },
    });
    if (vehicleConflict) this.vehicleScheduleConflict();
  }

  private scheduleConflictWhere(
    start: Date,
    end: Date,
    excludedTripId?: string,
  ): Prisma.LineHaulTripWhereInput {
    return {
      ...(excludedTripId ? { id: { not: excludedTripId } } : {}),
      status: { in: activeLineHaulTripStatuses },
      OR: [
        { scheduledStartAt: { lt: end }, scheduledEndAt: { gt: start } },
        { scheduledStartAt: null, status: { in: executingLineHaulTripStatuses } },
      ],
    };
  }

  private parseScheduleWindow(scheduledStartAt: string, scheduledEndAt: string) {
    const start = new Date(scheduledStartAt);
    const end = new Date(scheduledEndAt);
    this.policy.assertScheduleWindow(start, end);
    return { start, end };
  }

  private parseOptionalCreateSchedule(dto: CreateLineHaulTripDto) {
    const hasStart = dto.scheduledStartAt !== undefined;
    const hasEnd = dto.scheduledEndAt !== undefined;
    if (hasStart !== hasEnd) {
      throw new BadRequestException({
        code: 'LINE_HAUL_SCHEDULE_INCOMPLETE',
        message: 'Both scheduledStartAt and scheduledEndAt are required together',
      });
    }
    return hasStart && hasEnd
      ? this.parseScheduleWindow(dto.scheduledStartAt!, dto.scheduledEndAt!)
      : null;
  }

  private resolveListScheduleRange(query: ListLineHaulTripsDto) {
    if (!query.scheduledFrom && !query.scheduledTo) return null;
    if (!query.scheduledFrom || !query.scheduledTo) {
      throw new BadRequestException({
        code: 'LINE_HAUL_SCHEDULE_FILTER_INCOMPLETE',
        message: 'Both scheduledFrom and scheduledTo are required for a schedule filter',
      });
    }
    return this.parseScheduleWindow(query.scheduledFrom, query.scheduledTo);
  }

  private assertExpectedVersion(currentVersion: number, expectedVersion: number): void {
    if (currentVersion !== expectedVersion) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_CONCURRENT_MODIFICATION',
        message: 'Trip changed concurrently; reload and try again',
      });
    }
  }

  private activeAssignments(trip: LineHaulTripRecord) {
    return trip.transferAssignments
      .filter((assignment) => assignment.isActive)
      .sort((left, right) => left.warehouseTransferId.localeCompare(right.warehouseTransferId));
  }

  private assertRerouteActor(actor: AuthenticatedUser): void {
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.DISPATCHER) return;
    throw new ForbiddenException({
      code: 'LINE_HAUL_REROUTE_FORBIDDEN',
      message: 'Only an Admin or Dispatcher can recalculate a line-haul route',
    });
  }

  private async assertExecutionReady(
    transaction: Prisma.TransactionClient,
    trip: LineHaulTripRecord,
  ): Promise<{ manifestWeightGrams: number; vehicleCapacityWeightGrams: number }> {
    this.policy.assertSchedulePresent(trip);
    this.policy.assertDriverEligible(trip.driver);
    await this.driverOwnership.assertNoActiveAssignment(transaction, trip.driverId);
    this.policy.assertVehicleEligible(trip.vehicle);
    await this.assertScheduleResourcesAvailable(
      transaction,
      trip,
      trip.scheduledStartAt!,
      trip.scheduledEndAt!,
    );
    if (!trip.originWarehouse.isActive || !trip.destinationWarehouse.isActive) {
      throw new ConflictException({
        code: 'LINE_HAUL_WAREHOUSE_INACTIVE',
        message: 'Origin and destination warehouses must remain active',
      });
    }
    const assignments = this.activeAssignments(trip);
    if (assignments.length === 0) {
      throw new ConflictException({
        code: 'LINE_HAUL_MANIFEST_EMPTY',
        message: 'A line-haul trip needs at least one active transfer before it can be ready',
      });
    }
    for (const assignment of assignments) {
      this.transferLifecycle.assertDispatchableTransfer(assignment.warehouseTransfer, trip);
    }
    const manifestWeightGrams = calculateManifestWeightGrams(assignments);
    assertManifestWithinCapacity(manifestWeightGrams, trip.vehicle.capacityWeightGrams);
    return {
      manifestWeightGrams,
      vehicleCapacityWeightGrams: trip.vehicle.capacityWeightGrams,
    };
  }

  private async lockExecutionResources(
    transaction: Prisma.TransactionClient,
    trip: LineHaulTripRecord,
  ): Promise<void> {
    await this.driverOwnership.lock(transaction, trip.driverId);
    await this.lockVehicle(transaction, trip.vehicleId);
    const transferIds = this.activeAssignments(trip).map(
      (assignment) => assignment.warehouseTransferId,
    );
    if (transferIds.length > 0) {
      await transaction.$queryRaw(
        Prisma.sql`
          SELECT "id" FROM "WarehouseTransfer"
          WHERE "id" IN (${Prisma.join(
            transferIds.map((transferId) => Prisma.sql`${transferId}::uuid`),
          )})
          ORDER BY "id" FOR UPDATE
        `,
      );
    }
  }

  private async lockTrip(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "LineHaulTrip" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
  }

  private async lockTransfer(
    transaction: Prisma.TransactionClient,
    transferId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "WarehouseTransfer" WHERE "id" = ${transferId}::uuid FOR UPDATE
    `;
  }

  private async lockVehicle(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "LineHaulVehicle" WHERE "id" = ${vehicleId}::uuid FOR UPDATE
    `;
  }

  private assertTripUpdated(count: number): void {
    if (count !== 1) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_CONCURRENT_MODIFICATION',
        message: 'Trip changed concurrently; reload and try again',
      });
    }
  }

  private async assertDestinationConfirmationAccess(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    destinationWarehouseId: string,
  ): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role === UserRole.WAREHOUSE_STAFF) {
      const profile = await transaction.warehouseStaffProfile.findUnique({
        where: { userId: actor.id },
        select: { warehouseId: true, isActive: true },
      });
      if (profile?.isActive && profile.warehouseId === destinationWarehouseId) return;
    }
    throw new ForbiddenException({
      code: 'LINE_HAUL_ARRIVAL_SCOPE_FORBIDDEN',
      message: 'Only active destination warehouse staff can confirm trip arrival',
    });
  }

  private async resolveStaffWarehouseId(actor: AuthenticatedUser): Promise<string | null> {
    if (actor.role !== UserRole.WAREHOUSE_STAFF) return null;
    const profile = await this.prisma.warehouseStaffProfile.findUnique({
      where: { userId: actor.id },
      select: { warehouseId: true, isActive: true },
    });
    if (!profile?.isActive) {
      throw new ForbiddenException({
        code: 'LINE_HAUL_WAREHOUSE_SCOPE_FORBIDDEN',
        message: 'An active warehouse assignment is required',
      });
    }
    return profile.warehouseId;
  }

  private toResponse(
    trip: LineHaulTripRecord,
    actor: AuthenticatedUser,
    staffWarehouseId: string | null = null,
    remainingRoute: RouteMetric | null = null,
    routeHistory: Parameters<typeof toLineHaulTripResponse>[3] = [],
  ) {
    const canManage = actor.role === UserRole.ADMIN || actor.role === UserRole.DISPATCHER;
    const canConfirmDestination =
      actor.role === UserRole.ADMIN ||
      (actor.role === UserRole.WAREHOUSE_STAFF && staffWarehouseId === trip.destinationWarehouseId);
    return toLineHaulTripResponse(
      trip,
      {
        canManage,
        canConfirmDestination,
        canReroute: canManage && this.routes.roadProviderEnabled,
      },
      remainingRoute,
      routeHistory,
    );
  }

  private async plannedRoute(id: string): Promise<RouteMetric | null> {
    const trip = await this.prisma.lineHaulTrip.findUnique({
      where: { id },
      select: {
        status: true,
        originWarehouseId: true,
        destinationWarehouseId: true,
        transferAssignments: {
          where: { isActive: true },
          select: {
            warehouseTransfer: {
              select: {
                fromWarehouseId: true,
                toWarehouseId: true,
                status: true,
                shipment: { select: { status: true, currentWarehouseId: true } },
              },
            },
          },
        },
        originWarehouse: { select: { latitude: true, longitude: true } },
        destinationWarehouse: { select: { latitude: true, longitude: true } },
      },
    });
    if (!trip) this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
    if (
      trip.status !== LineHaulTripStatus.PLANNED ||
      trip.transferAssignments.length === 0 ||
      trip.transferAssignments.some(
        ({ warehouseTransfer }) =>
          warehouseTransfer.status !== WarehouseTransferStatus.PENDING ||
          warehouseTransfer.fromWarehouseId !== trip.originWarehouseId ||
          warehouseTransfer.toWarehouseId !== trip.destinationWarehouseId ||
          warehouseTransfer.shipment.status !== ShipmentStatus.AT_ORIGIN_WAREHOUSE ||
          warehouseTransfer.shipment.currentWarehouseId !== trip.originWarehouseId,
      )
    ) {
      return null;
    }
    const origin = this.warehousePoint(trip.originWarehouse);
    const destination = this.warehousePoint(trip.destinationWarehouse);
    return origin && destination
      ? this.routes.calculateWithGeometry({ origin, destination })
      : null;
  }

  private async remainingRoute(
    actor: AuthenticatedUser,
    trip: LineHaulTripRecord,
  ): Promise<RouteMetric | null> {
    if (trip.status !== LineHaulTripStatus.IN_TRANSIT) return null;
    const location = await this.locations.getLineHaulTripLocation(actor, trip.id);
    const destination = this.warehousePoint(trip.destinationWarehouse);
    if (location.locationState !== 'CURRENT' || !location.location || !destination) return null;
    return this.routes.calculate({
      origin: {
        latitude: location.location.latitude,
        longitude: location.location.longitude,
      },
      destination,
    });
  }

  private warehousePoint(warehouse: {
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  }): { latitude: number; longitude: number } | null {
    const latitude = warehouse.latitude === null ? NaN : Number(warehouse.latitude);
    const longitude = warehouse.longitude === null ? NaN : Number(warehouse.longitude);
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

  private async resolveCreateConflict(actor: AuthenticatedUser, dto: CreateLineHaulTripDto) {
    const committed = await this.prisma.lineHaulTrip.findUnique({
      where: {
        createdById_clientRequestId: {
          createdById: actor.id,
          clientRequestId: dto.clientRequestId,
        },
      },
      include: lineHaulTripInclude,
    });
    if (committed) {
      this.assertIdempotency(committed, dto);
      return this.toResponse(committed, actor);
    }
    throw new ConflictException({
      code: 'LINE_HAUL_TRIP_CONFLICT',
      message: 'Trip changed concurrently; reload and try again',
    });
  }

  private assertIdempotency(trip: LineHaulTripRecord, dto: CreateLineHaulTripDto): void {
    const schedule = this.parseOptionalCreateSchedule(dto);
    const plannedDepartureAt = dto.plannedDepartureAt
      ? new Date(dto.plannedDepartureAt).getTime()
      : (schedule?.start.getTime() ?? null);
    const requestedTransferIds = [...(dto.warehouseTransferIds ?? [])].sort();
    const committedTransferIds = trip.transferAssignments
      .filter((assignment) => assignment.isActive)
      .map((assignment) => assignment.warehouseTransferId)
      .sort();
    if (
      trip.originWarehouseId !== dto.originWarehouseId ||
      trip.destinationWarehouseId !== dto.destinationWarehouseId ||
      trip.driverId !== dto.driverId ||
      trip.vehicleId !== dto.vehicleId ||
      (trip.plannedDepartureAt?.getTime() ?? null) !== plannedDepartureAt ||
      (trip.scheduledStartAt?.getTime() ?? null) !== (schedule?.start.getTime() ?? null) ||
      (trip.scheduledEndAt?.getTime() ?? null) !== (schedule?.end.getTime() ?? null) ||
      requestedTransferIds.length !== committedTransferIds.length ||
      requestedTransferIds.some((id, index) => id !== committedTransferIds[index])
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'The idempotency key was already used for another line-haul trip',
      });
    }
  }

  private generateTripCode(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `LHT-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private driverScheduleConflict(): never {
    throw new ConflictException({
      code: 'LINE_HAUL_DRIVER_SCHEDULE_CONFLICT',
      message: 'Driver is already reserved for an overlapping line-haul trip',
    });
  }

  private vehicleScheduleConflict(): never {
    throw new ConflictException({
      code: 'LINE_HAUL_VEHICLE_SCHEDULE_CONFLICT',
      message: 'Vehicle is already reserved for an overlapping line-haul trip',
    });
  }

  private scheduleResourceConflict(): never {
    throw new ConflictException({
      code: 'LINE_HAUL_SCHEDULE_CONFLICT',
      message: 'Driver or vehicle was reserved concurrently; reload availability and try again',
    });
  }

  private transferOwnershipConflict(): never {
    throw new ConflictException({
      code: 'WAREHOUSE_TRANSFER_ACTIVE_TRIP',
      message: 'Warehouse transfer already belongs to another active line-haul trip',
    });
  }

  private notFound(code: string, message: string): never {
    throw new NotFoundException({ code, message });
  }
}
