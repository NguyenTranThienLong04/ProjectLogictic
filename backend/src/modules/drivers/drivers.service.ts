import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DriverAssignmentType,
  DriverCapability,
  DriverAssignmentStatus,
  DriverStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import type { CreateDriverProfileDto } from './dto/create-driver-profile.dto.js';
import type { ListDriversDto } from './dto/list-drivers.dto.js';
import type { UpdateDriverProfileDto } from './dto/update-driver-profile.dto.js';
import type { SetDriverCapabilitiesDto } from './dto/set-driver-capabilities.dto.js';
import { executingLineHaulTripStatuses } from '../line-haul/line-haul.constants.js';
import {
  toDriverResponse,
  type DriverResponse,
  type PaginatedDriversResponse,
} from './driver.response.js';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateDriverProfileDto,
    context: ClientContext,
  ): Promise<DriverResponse> {
    try {
      const profile = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({ where: { id: dto.userId } });
        if (!user) throw this.notFound('USER_NOT_FOUND', 'Driver account was not found');
        if (user.role !== UserRole.DRIVER) {
          throw new ConflictException({
            code: 'DRIVER_ROLE_REQUIRED',
            message: 'A driver profile can only be attached to a DRIVER account',
          });
        }
        const operatingWarehouse = await transaction.warehouse.findFirst({
          where: { id: dto.operatingWarehouseId, isActive: true },
          select: { id: true },
        });
        if (!operatingWarehouse) {
          throw new ConflictException({
            code: 'OPERATING_WAREHOUSE_INVALID',
            message: 'Operating warehouse must exist and be active',
          });
        }

        const created = await transaction.driverProfile.create({
          data: {
            userId: user.id,
            operatingWarehouseId: operatingWarehouse.id,
            employeeCode: dto.employeeCode.trim().toUpperCase(),
            vehicleType: dto.vehicleType.trim(),
            vehiclePlate: dto.vehiclePlate.trim().toUpperCase(),
            capabilities: [DriverCapability.PICKUP, DriverCapability.DELIVERY],
            status:
              user.status === UserStatus.SUSPENDED ? DriverStatus.SUSPENDED : DriverStatus.OFFLINE,
          },
          include: { user: true, operatingWarehouse: true },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'DRIVER_PROFILE_CREATE',
            entityType: 'DriverProfile',
            entityId: created.id,
            after: {
              userId: created.userId,
              operatingWarehouseId: created.operatingWarehouseId,
              employeeCode: created.employeeCode,
              status: created.status,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return created;
      });
      return toDriverResponse(profile);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'DRIVER_PROFILE_CONFLICT',
          message: 'The account or employee code already has a driver profile',
        });
      }
      throw error;
    }
  }

  async list(query: ListDriversDto): Promise<PaginatedDriversResponse> {
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const where: Prisma.DriverProfileWhereInput = {
      ...(query.capability ? { capabilities: { has: query.capability } } : {}),
      ...(query.operatingWarehouseId ? { operatingWarehouseId: query.operatingWarehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.fromDate || toDateExclusive
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { employeeCode: { contains: search, mode: 'insensitive' } },
              { vehiclePlate: { contains: search, mode: 'insensitive' } },
              { user: { fullName: { contains: search, mode: 'insensitive' } } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const profiles = await this.prisma.driverProfile.findMany({
      where,
      include: { user: true, operatingWarehouse: true },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.driverProfile.count({ where });
    return {
      items: profiles.map(toDriverResponse),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listAvailable(): Promise<DriverResponse[]> {
    const profiles = await this.prisma.driverProfile.findMany({
      where: {
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
        user: { status: UserStatus.ACTIVE, role: UserRole.DRIVER },
      },
      include: { user: true, operatingWarehouse: true },
      orderBy: { updatedAt: 'asc' },
    });
    return profiles.map(toDriverResponse);
  }

  async getMine(userId: string): Promise<DriverResponse> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: true, operatingWarehouse: true },
    });
    if (!profile) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    return toDriverResponse(profile);
  }

  async update(
    actor: AuthenticatedUser,
    profileId: string,
    dto: UpdateDriverProfileDto,
    context: ClientContext,
  ): Promise<DriverResponse> {
    const profile = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.driverProfile.findUnique({
        where: { id: profileId },
        include: { user: true, operatingWarehouse: true },
      });
      if (!current) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
      const changesOperatingWarehouse =
        dto.operatingWarehouseId !== undefined &&
        dto.operatingWarehouseId !== current.operatingWarehouseId;
      if (dto.suspended === true || changesOperatingWarehouse) {
        const active = await transaction.driverAssignment.count({
          where: {
            driverId: profileId,
            status: { in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED] },
          },
        });
        if (active > 0) {
          throw new ConflictException({
            code: 'DRIVER_HAS_ACTIVE_ASSIGNMENT',
            message: changesOperatingWarehouse
              ? 'Complete or reassign the active shipment before changing operating warehouse'
              : 'Reassign the active shipment before suspending this driver',
          });
        }
        if (dto.suspended === true) {
          const activeLineHaulTrips = await transaction.lineHaulTrip.count({
            where: { driverId: profileId, status: { in: executingLineHaulTripStatuses } },
          });
          if (activeLineHaulTrips > 0) {
            throw new ConflictException({
              code: 'DRIVER_HAS_ACTIVE_LINE_HAUL_TRIP',
              message:
                'Return the line-haul trip from READY or finish it before suspending this driver',
            });
          }
        }
      }
      if (dto.suspended === false && current.user.status !== UserStatus.ACTIVE) {
        throw new ConflictException({
          code: 'DRIVER_USER_SUSPENDED',
          message: 'Restore the driver user account before restoring the profile',
        });
      }
      if (dto.operatingWarehouseId !== undefined) {
        const warehouse = await transaction.warehouse.findFirst({
          where: { id: dto.operatingWarehouseId, isActive: true },
          select: { id: true },
        });
        if (!warehouse) {
          throw new ConflictException({
            code: 'OPERATING_WAREHOUSE_INVALID',
            message: 'Operating warehouse must exist and be active',
          });
        }
      }

      const update = await transaction.driverProfile.updateMany({
        where: { id: profileId, version: current.version },
        data: {
          ...(dto.operatingWarehouseId !== undefined
            ? { operatingWarehouseId: dto.operatingWarehouseId }
            : {}),
          ...(dto.vehicleType !== undefined ? { vehicleType: dto.vehicleType.trim() } : {}),
          ...(dto.vehiclePlate !== undefined
            ? { vehiclePlate: dto.vehiclePlate.trim().toUpperCase() }
            : {}),
          ...(dto.suspended === true
            ? { status: DriverStatus.SUSPENDED, isOnline: false, isAvailable: false }
            : {}),
          ...(dto.suspended === false
            ? { status: DriverStatus.OFFLINE, isOnline: false, isAvailable: false }
            : {}),
          version: { increment: 1 },
        },
      });
      this.assertUpdated(update.count);
      const updated = await transaction.driverProfile.findUniqueOrThrow({
        where: { id: profileId },
        include: { user: true, operatingWarehouse: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'DRIVER_PROFILE_UPDATE',
          entityType: 'DriverProfile',
          entityId: profileId,
          before: {
            vehicleType: current.vehicleType,
            vehiclePlate: current.vehiclePlate,
            operatingWarehouseId: current.operatingWarehouseId,
            status: current.status,
          },
          after: {
            vehicleType: updated.vehicleType,
            vehiclePlate: updated.vehiclePlate,
            operatingWarehouseId: updated.operatingWarehouseId,
            status: updated.status,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return toDriverResponse(profile);
  }

  async setCapabilities(
    actor: AuthenticatedUser,
    profileId: string,
    dto: SetDriverCapabilitiesDto,
    context: ClientContext,
  ): Promise<DriverResponse> {
    const profile = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.driverProfile.findUnique({
        where: { id: profileId },
        include: { user: true, operatingWarehouse: true },
      });
      if (!current) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
      const canonicalCapabilities = [
        DriverCapability.PICKUP,
        DriverCapability.DELIVERY,
        DriverCapability.LINE_HAUL,
      ].filter((capability) => dto.capabilities.includes(capability));
      if (
        current.capabilities.length === canonicalCapabilities.length &&
        current.capabilities.every((capability) => canonicalCapabilities.includes(capability))
      ) {
        return current;
      }

      const removed = current.capabilities.filter(
        (capability) => !canonicalCapabilities.includes(capability),
      );
      const removedAssignmentTypes = [
        ...(removed.includes(DriverCapability.PICKUP) ? [DriverAssignmentType.PICKUP] : []),
        ...(removed.includes(DriverCapability.DELIVERY) ? [DriverAssignmentType.DELIVERY] : []),
      ];
      if (removedAssignmentTypes.length > 0) {
        const activeAssignments = await transaction.driverAssignment.count({
          where: {
            driverId: profileId,
            type: { in: removedAssignmentTypes },
            status: { in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED] },
          },
        });
        if (activeAssignments > 0) {
          throw new ConflictException({
            code: 'DRIVER_CAPABILITY_IN_USE',
            message: 'Complete or reassign active shipments before removing this capability',
          });
        }
      }
      if (removed.includes(DriverCapability.LINE_HAUL)) {
        const activeTrips = await transaction.lineHaulTrip.count({
          where: { driverId: profileId, status: { in: executingLineHaulTripStatuses } },
        });
        if (activeTrips > 0) {
          throw new ConflictException({
            code: 'DRIVER_CAPABILITY_IN_USE',
            message: 'Return the line-haul trip from READY or finish it before removing capability',
          });
        }
      }

      const update = await transaction.driverProfile.updateMany({
        where: { id: profileId, version: current.version },
        data: { capabilities: canonicalCapabilities, version: { increment: 1 } },
      });
      this.assertUpdated(update.count);
      const updated = await transaction.driverProfile.findUniqueOrThrow({
        where: { id: profileId },
        include: { user: true, operatingWarehouse: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'DRIVER_CAPABILITIES_SET',
          entityType: 'DriverProfile',
          entityId: profileId,
          before: { capabilities: current.capabilities },
          after: { capabilities: updated.capabilities },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return toDriverResponse(profile);
  }

  async setAvailability(
    actor: AuthenticatedUser,
    isOnline: boolean,
    context: ClientContext,
  ): Promise<DriverResponse> {
    const profile = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.driverProfile.findUnique({
        where: { userId: actor.id },
        include: { user: true, operatingWarehouse: true },
      });
      if (!current) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
      if (current.status === DriverStatus.SUSPENDED || current.user.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException({
          code: 'DRIVER_SUSPENDED',
          message: 'A suspended driver cannot become available',
        });
      }
      const active = await transaction.driverAssignment.count({
        where: {
          driverId: current.id,
          status: { in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED] },
        },
      });
      if (active > 0 && !isOnline) {
        throw new ConflictException({
          code: 'DRIVER_HAS_ACTIVE_ASSIGNMENT',
          message: 'Reject or complete the active assignment before going offline',
        });
      }

      const update = await transaction.driverProfile.updateMany({
        where: { id: current.id, version: current.version },
        data: isOnline
          ? active > 0
            ? {
                status: DriverStatus.BUSY,
                isOnline: true,
                isAvailable: false,
                version: { increment: 1 },
              }
            : {
                status: DriverStatus.AVAILABLE,
                isOnline: true,
                isAvailable: true,
                version: { increment: 1 },
              }
          : {
              status: DriverStatus.OFFLINE,
              isOnline: false,
              isAvailable: false,
              version: { increment: 1 },
            },
      });
      this.assertUpdated(update.count);
      const updated = await transaction.driverProfile.findUniqueOrThrow({
        where: { id: current.id },
        include: { user: true, operatingWarehouse: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'DRIVER_AVAILABILITY_SET',
          entityType: 'DriverProfile',
          entityId: current.id,
          before: { status: current.status, isOnline: current.isOnline },
          after: { status: updated.status, isOnline: updated.isOnline },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return toDriverResponse(profile);
  }

  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }

  private assertUpdated(count: number): void {
    if (count !== 1) {
      throw new ConflictException({
        code: 'DRIVER_CONCURRENT_MODIFICATION',
        message: 'Driver changed concurrently; reload and try again',
      });
    }
  }
}
