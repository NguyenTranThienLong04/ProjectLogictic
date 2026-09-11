import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LineHaulVehicleStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import type { CreateLineHaulVehicleDto } from './dto/create-line-haul-vehicle.dto.js';
import type { ListLineHaulVehiclesDto } from './dto/list-line-haul-vehicles.dto.js';
import type { UpdateLineHaulVehicleCapacityDto } from './dto/update-line-haul-vehicle-capacity.dto.js';
import {
  activeLineHaulTripStatuses,
  executingLineHaulTripStatuses,
} from './line-haul.constants.js';
import {
  assertManifestWithinCapacity,
  assertValidVehicleCapacity,
  calculateManifestWeightGrams,
} from './line-haul-capacity.js';
import { toLineHaulVehicleResponse } from './line-haul.response.js';

@Injectable()
export class LineHaulVehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: AuthenticatedUser, dto: CreateLineHaulVehicleDto, context: ClientContext) {
    try {
      const vehicle = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.lineHaulVehicle.create({
          data: {
            vehicleCode: this.normalizeCode(dto.vehicleCode),
            licensePlate: this.normalizePlate(dto.licensePlate),
            vehicleType: dto.vehicleType.trim(),
            capacityWeightGrams: dto.capacityWeightGrams,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'LINE_HAUL_VEHICLE_CREATED',
            entityType: 'LineHaulVehicle',
            entityId: created.id,
            after: {
              vehicleCode: created.vehicleCode,
              licensePlate: created.licensePlate,
              vehicleType: created.vehicleType,
              capacityWeightGrams: created.capacityWeightGrams,
              status: created.status,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return created;
      });
      return toLineHaulVehicleResponse(vehicle);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_UNIQUE_CONFLICT',
          message: 'Vehicle code or license plate is already in use',
        });
      }
      throw error;
    }
  }

  async list(query: ListLineHaulVehiclesDto) {
    const search = query.search?.trim();
    const where: Prisma.LineHaulVehicleWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { vehicleCode: { contains: search, mode: 'insensitive' } },
              { licensePlate: { contains: search, mode: 'insensitive' } },
              { vehicleType: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.lineHaulVehicle.findMany({
        where,
        orderBy: [{ status: 'asc' }, { vehicleCode: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.lineHaulVehicle.count({ where }),
    ]);
    return {
      items: items.map(toLineHaulVehicleResponse),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async get(id: string) {
    const vehicle = await this.prisma.lineHaulVehicle.findUnique({ where: { id } });
    if (!vehicle) this.notFound();
    return toLineHaulVehicleResponse(vehicle);
  }

  async updateCapacity(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateLineHaulVehicleCapacityDto,
    context: ClientContext,
  ) {
    assertValidVehicleCapacity(dto.capacityWeightGrams);
    const activeTripHints = await this.prisma.lineHaulTrip.findMany({
      where: { vehicleId: id, status: { in: activeLineHaulTripStatuses } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const vehicle = await this.prisma.$transaction(async (transaction) => {
      for (const trip of activeTripHints) await this.lockTrip(transaction, trip.id);
      await this.lockVehicle(transaction, id);
      const current = await transaction.lineHaulVehicle.findUnique({ where: { id } });
      if (!current) this.notFound();
      if (current.capacityWeightGrams === dto.capacityWeightGrams) return current;
      if (current.status === LineHaulVehicleStatus.IN_USE) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_IN_USE',
          message: 'Vehicle capacity cannot change while the vehicle is in use',
        });
      }

      const activeTrips = await transaction.lineHaulTrip.findMany({
        where: { vehicleId: id, status: { in: activeLineHaulTripStatuses } },
        include: {
          transferAssignments: {
            include: {
              warehouseTransfer: {
                include: { shipment: { select: { packageSnapshot: true } } },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
      });
      if (
        activeTrips.length !== activeTripHints.length ||
        activeTrips.some((trip, index) => trip.id !== activeTripHints[index]?.id)
      ) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_CONCURRENT_MODIFICATION',
          message: 'Vehicle trip ownership changed concurrently; reload and try again',
        });
      }
      const activeManifestWeights = activeTrips.map((trip) => ({
        tripId: trip.id,
        manifestWeightGrams: calculateManifestWeightGrams(trip.transferAssignments),
      }));
      for (const activeManifest of activeManifestWeights) {
        assertManifestWithinCapacity(activeManifest.manifestWeightGrams, dto.capacityWeightGrams);
      }

      const update = await transaction.lineHaulVehicle.updateMany({
        where: { id, version: current.version },
        data: {
          capacityWeightGrams: dto.capacityWeightGrams,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_CONCURRENT_MODIFICATION',
          message: 'Vehicle changed concurrently; reload and try again',
        });
      }
      const updated = await transaction.lineHaulVehicle.findUniqueOrThrow({ where: { id } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'LINE_HAUL_VEHICLE_CAPACITY_UPDATED',
          entityType: 'LineHaulVehicle',
          entityId: id,
          before: { capacityWeightGrams: current.capacityWeightGrams },
          after: { capacityWeightGrams: updated.capacityWeightGrams },
          metadata: {
            activeTrips: activeManifestWeights,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return toLineHaulVehicleResponse(vehicle);
  }

  activate(actor: AuthenticatedUser, id: string, context: ClientContext) {
    return this.setOperationalStatus(actor, id, LineHaulVehicleStatus.AVAILABLE, context);
  }

  markMaintenance(actor: AuthenticatedUser, id: string, context: ClientContext) {
    return this.setOperationalStatus(actor, id, LineHaulVehicleStatus.MAINTENANCE, context);
  }

  deactivate(actor: AuthenticatedUser, id: string, context: ClientContext) {
    return this.setOperationalStatus(actor, id, LineHaulVehicleStatus.INACTIVE, context);
  }

  private async setOperationalStatus(
    actor: AuthenticatedUser,
    id: string,
    status: Exclude<LineHaulVehicleStatus, 'IN_USE'>,
    context: ClientContext,
  ) {
    const vehicle = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "LineHaulVehicle" WHERE "id" = ${id}::uuid FOR UPDATE
      `;
      const current = await transaction.lineHaulVehicle.findUnique({ where: { id } });
      if (!current) this.notFound();
      if (current.status === status) {
        if (status === LineHaulVehicleStatus.AVAILABLE) {
          assertValidVehicleCapacity(current.capacityWeightGrams);
        }
        return current;
      }
      if (current.status === LineHaulVehicleStatus.IN_USE) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_IN_USE',
          message: 'An in-use vehicle can only be released by the trip lifecycle',
        });
      }
      const activeTrip = await transaction.lineHaulTrip.count({
        where: { vehicleId: id, status: { in: executingLineHaulTripStatuses } },
      });
      if (activeTrip > 0) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_HAS_ACTIVE_TRIP',
          message: 'Return the trip from READY or finish it before changing vehicle availability',
        });
      }
      if (status === LineHaulVehicleStatus.AVAILABLE) {
        assertValidVehicleCapacity(current.capacityWeightGrams);
      }
      const update = await transaction.lineHaulVehicle.updateMany({
        where: { id, version: current.version },
        data: { status, version: { increment: 1 } },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'LINE_HAUL_VEHICLE_CONCURRENT_MODIFICATION',
          message: 'Vehicle changed concurrently; reload and try again',
        });
      }
      const updated = await transaction.lineHaulVehicle.findUniqueOrThrow({ where: { id } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action:
            status === LineHaulVehicleStatus.AVAILABLE
              ? 'LINE_HAUL_VEHICLE_ACTIVATED'
              : status === LineHaulVehicleStatus.MAINTENANCE
                ? 'LINE_HAUL_VEHICLE_MAINTENANCE_SET'
                : 'LINE_HAUL_VEHICLE_DEACTIVATED',
          entityType: 'LineHaulVehicle',
          entityId: id,
          before: { status: current.status },
          after: { status: updated.status },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return toLineHaulVehicleResponse(vehicle);
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizePlate(value: string): string {
    return value.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  private async lockTrip(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "LineHaulTrip" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
  }

  private async lockVehicle(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "LineHaulVehicle" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'LINE_HAUL_VEHICLE_NOT_FOUND',
      message: 'Line-haul vehicle was not found',
    });
  }
}
