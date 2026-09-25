import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShipmentStatus,
  TrackingVisibility,
  UserRole,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { ShipmentTransitionPolicy } from '../assignments/shipment-transition.policy.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { PackageSnapshot } from '../shipments/shipment.response.js';
import type { AssignWarehouseStaffDto } from './dto/assign-warehouse-staff.dto.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
import type { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import type { ListWarehouseShipmentsDto } from './dto/list-warehouse-shipments.dto.js';
import type { ListWarehouseExceptionsDto } from './dto/list-warehouse-exceptions.dto.js';
import type { ListWarehousesDto } from './dto/list-warehouses.dto.js';
import type { ReceiveTransferDto } from './dto/receive-transfer.dto.js';
import type { RouteDestinationDto } from './dto/route-destination.dto.js';
import type { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import type { WarehouseCheckInDto } from './dto/warehouse-check-in.dto.js';
import { warehouseListWhere } from './warehouse-list-query.js';
import { WarehouseTransferLifecycleService } from './warehouse-transfer-lifecycle.service.js';
import {
  toWarehouseResponse,
  toWarehouseStaffProfileResponse,
  toWarehouseCatalogResponse,
  toWarehouseTransferResponse,
  warehouseShipmentInclude,
  warehouseTransferResponseInclude,
  type WarehouseCatalogResponse,
  type WarehouseResponse,
  type WarehouseShipment,
  type WarehouseStaffProfileResponse,
  type WarehouseTransferResponse,
} from './warehouse.response.js';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitionPolicy: ShipmentTransitionPolicy,
    private readonly notifications: NotificationsService,
    private readonly transferLifecycle: WarehouseTransferLifecycleService,
  ) {}

  // ==========================================
  // WAREHOUSE CRUD
  // ==========================================

  async createWarehouse(
    dto: CreateWarehouseDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseResponse> {
    const warehouse = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.warehouse.findUnique({
        where: { code: dto.code.trim().toUpperCase() },
      });
      if (existing) {
        throw new ConflictException({
          code: 'WAREHOUSE_CODE_EXISTS',
          message: `Warehouse with code "${dto.code}" already exists`,
        });
      }

      const created = await transaction.warehouse.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          address: dto.address.trim(),
          ward: dto.ward?.trim() || null,
          district: dto.district?.trim() || null,
          city: dto.city.trim(),
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isActive: dto.isActive ?? true,
        },
      });

      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'WAREHOUSE_CREATED',
          entityType: 'WAREHOUSE',
          entityId: created.id,
          after: {
            code: created.code,
            name: created.name,
            city: created.city,
            isActive: created.isActive,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return created;
    });

    return toWarehouseResponse(warehouse);
  }

  async updateWarehouse(
    id: string,
    dto: UpdateWarehouseDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseResponse> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.warehouse.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: 'Warehouse not found',
        });
      }

      const addressChanged = (['address', 'ward', 'district', 'city'] as const).some(
        (field) =>
          dto[field] !== undefined && (dto[field]?.trim() || '') !== (existing[field] || ''),
      );
      if (addressChanged && (dto.latitude == null || dto.longitude == null)) {
        throw new BadRequestException({
          code: 'WAREHOUSE_LOCATION_REQUIRED',
          message: 'Confirm a new location when changing the warehouse address',
        });
      }

      const update = await transaction.warehouse.updateMany({
        where: { id, version: existing.version },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.address ? { address: dto.address.trim() } : {}),
          ...(dto.ward !== undefined ? { ward: dto.ward?.trim() || null } : {}),
          ...(dto.district !== undefined ? { district: dto.district?.trim() || null } : {}),
          ...(dto.city ? { city: dto.city.trim() } : {}),
          ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
          ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          version: { increment: 1 },
        },
      });
      this.assertConcurrentUpdate(update.count, 'Warehouse');
      const result = await transaction.warehouse.findUniqueOrThrow({ where: { id } });

      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'WAREHOUSE_UPDATED',
          entityType: 'WAREHOUSE',
          entityId: id,
          before: {
            name: existing.name,
            address: existing.address,
            city: existing.city,
            isActive: existing.isActive,
          },
          after: {
            name: result.name,
            address: result.address,
            city: result.city,
            isActive: result.isActive,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return result;
    });

    return toWarehouseResponse(updated);
  }

  async toggleWarehouseStatus(
    id: string,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseResponse> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.warehouse.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: 'Warehouse not found',
        });
      }

      const update = await transaction.warehouse.updateMany({
        where: { id, version: existing.version },
        data: { isActive: !existing.isActive, version: { increment: 1 } },
      });
      this.assertConcurrentUpdate(update.count, 'Warehouse');
      const result = await transaction.warehouse.findUniqueOrThrow({ where: { id } });

      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: result.isActive ? 'WAREHOUSE_ACTIVATED' : 'WAREHOUSE_DEACTIVATED',
          entityType: 'WAREHOUSE',
          entityId: id,
          before: { isActive: existing.isActive },
          after: { isActive: result.isActive },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return result;
    });

    return toWarehouseResponse(updated);
  }

  async getWarehouse(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<WarehouseResponse | WarehouseCatalogResponse> {
    const staffWarehouseId = await this.resolveStaffWarehouseId(actor);
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            staffProfiles: true,
            currentShipments: true,
          },
        },
      },
    });
    if (!warehouse) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
    return staffWarehouseId && staffWarehouseId !== id
      ? toWarehouseCatalogResponse(warehouse)
      : toWarehouseResponse(warehouse);
  }

  async listWarehouses(query: ListWarehousesDto, actor: AuthenticatedUser) {
    const staffWarehouseId = await this.resolveStaffWarehouseId(actor);
    const where = warehouseListWhere(query);
    const [matches, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Warehouse" WHERE ${where}
        ORDER BY "isActive" DESC, "code" ASC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*) AS total FROM "Warehouse" WHERE ${where}
      `),
    ]);
    const total = Number(counts[0].total);
    const items = await this.prisma.warehouse.findMany({
      where: { id: { in: matches.map((match) => match.id) } },
      include: {
        _count: {
          select: {
            staffProfiles: true,
            currentShipments: true,
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });

    return {
      items: items.map((warehouse) =>
        staffWarehouseId && staffWarehouseId !== warehouse.id
          ? toWarehouseCatalogResponse(warehouse)
          : toWarehouseResponse(warehouse),
      ),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  // ==========================================
  // WAREHOUSE STAFF MANAGEMENT
  // ==========================================

  async assignStaff(
    warehouseId: string,
    dto: AssignWarehouseStaffDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseStaffProfileResponse> {
    const profile = await this.prisma.$transaction(async (transaction) => {
      const warehouse = await transaction.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) {
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: 'Warehouse not found',
        });
      }

      const user = await transaction.user.findUnique({
        where: { id: dto.userId },
        include: { warehouseStaffProfile: true },
      });
      if (!user) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'Staff user not found',
        });
      }
      if (user.role !== UserRole.WAREHOUSE_STAFF) {
        throw new BadRequestException({
          code: 'INVALID_STAFF_ROLE',
          message: 'User must have WAREHOUSE_STAFF role',
        });
      }

      const existingCode = await transaction.warehouseStaffProfile.findUnique({
        where: { staffCode: dto.staffCode.trim().toUpperCase() },
      });
      if (existingCode && existingCode.userId !== user.id) {
        throw new ConflictException({
          code: 'STAFF_CODE_EXISTS',
          message: `Staff code "${dto.staffCode}" is already in use`,
        });
      }

      if (user.warehouseStaffProfile) {
        const update = await transaction.warehouseStaffProfile.updateMany({
          where: {
            id: user.warehouseStaffProfile.id,
            version: user.warehouseStaffProfile.version,
          },
          data: {
            warehouseId,
            staffCode: dto.staffCode.trim().toUpperCase(),
            isActive: true,
            version: { increment: 1 },
          },
        });
        this.assertConcurrentUpdate(update.count, 'WarehouseStaffProfile');
      } else {
        await transaction.warehouseStaffProfile.create({
          data: {
            userId: user.id,
            warehouseId,
            staffCode: dto.staffCode.trim().toUpperCase(),
            isActive: true,
          },
        });
      }
      const result = await transaction.warehouseStaffProfile.findUniqueOrThrow({
        where: { userId: user.id },
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
          warehouse: { select: { id: true, code: true, name: true, city: true } },
        },
      });

      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'WAREHOUSE_STAFF_ASSIGNED',
          entityType: 'WAREHOUSE_STAFF_PROFILE',
          entityId: result.id,
          after: {
            staffCode: result.staffCode,
            warehouseId,
            userId: user.id,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return result;
    });

    return toWarehouseStaffProfileResponse(profile);
  }

  async listStaff(warehouseId: string): Promise<WarehouseStaffProfileResponse[]> {
    const profiles = await this.prisma.warehouseStaffProfile.findMany({
      where: { warehouseId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        warehouse: { select: { id: true, code: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return profiles.map(toWarehouseStaffProfileResponse);
  }

  async getStaffProfileForUser(userId: string): Promise<WarehouseStaffProfileResponse> {
    const profile = await this.prisma.warehouseStaffProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        warehouse: { select: { id: true, code: true, name: true, city: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'WAREHOUSE_STAFF_PROFILE_NOT_FOUND',
        message: 'No warehouse profile assigned to this staff account',
      });
    }
    return toWarehouseStaffProfileResponse(profile);
  }

  async toggleStaffStatus(
    profileId: string,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseStaffProfileResponse> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.warehouseStaffProfile.findUnique({
        where: { id: profileId },
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
          warehouse: { select: { id: true, code: true, name: true, city: true } },
        },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'STAFF_PROFILE_NOT_FOUND',
          message: 'Warehouse staff profile not found',
        });
      }

      const update = await transaction.warehouseStaffProfile.updateMany({
        where: { id: profileId, version: existing.version },
        data: { isActive: !existing.isActive, version: { increment: 1 } },
      });
      this.assertConcurrentUpdate(update.count, 'WarehouseStaffProfile');
      const result = await transaction.warehouseStaffProfile.findUniqueOrThrow({
        where: { id: profileId },
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
          warehouse: { select: { id: true, code: true, name: true, city: true } },
        },
      });

      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: result.isActive ? 'WAREHOUSE_STAFF_ACTIVATED' : 'WAREHOUSE_STAFF_SUSPENDED',
          entityType: 'WAREHOUSE_STAFF_PROFILE',
          entityId: profileId,
          before: { isActive: existing.isActive },
          after: { isActive: result.isActive },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return result;
    });

    return toWarehouseStaffProfileResponse(updated);
  }

  // ==========================================
  // WAREHOUSE INBOUND & CHECK-IN
  // ==========================================

  async lookupCheckInShipment(warehouseId: string, trackingCode: string, actor: AuthenticatedUser) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    await this.requireActiveWarehouse(warehouseId);

    const shipment = await this.findWarehouseShipment({ trackingCode });
    this.assertExpectedOriginWarehouse(shipment, warehouseId);

    const isIdempotentOriginCheckIn =
      shipment.status === ShipmentStatus.AT_ORIGIN_WAREHOUSE &&
      shipment.currentWarehouseId === warehouseId;
    if (shipment.status !== ShipmentStatus.PICKED_UP && !isIdempotentOriginCheckIn) {
      throw new ConflictException({
        code: 'INVALID_SHIPMENT_STATUS_FOR_CHECK_IN',
        message: `Cannot check in shipment in status "${shipment.status}". Expected PICKED_UP.`,
      });
    }

    return this.serializeShipment(shipment);
  }

  async checkIn(
    warehouseId: string,
    dto: WarehouseCheckInDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const warehouse = await this.requireActiveWarehouse(warehouseId);
    const shipment = await this.findWarehouseShipment(dto);
    const expectedOriginWarehouseId = this.assertExpectedOriginWarehouse(shipment, warehouseId);

    if (!dto.packageVerified) {
      throw new BadRequestException({
        code: 'PACKAGE_VERIFICATION_REQUIRED',
        message: 'Package verification must be confirmed before origin check-in',
      });
    }

    // Idempotency is limited to the origin check-in command. Destination receipt has its own command.
    if (
      shipment.currentWarehouseId === warehouse.id &&
      shipment.status === ShipmentStatus.AT_ORIGIN_WAREHOUSE
    ) {
      return {
        idempotent: true,
        shipment: this.serializeShipment(shipment),
      };
    }

    // Origin Check-in from PICKED_UP
    if (shipment.status === ShipmentStatus.PICKED_UP) {
      this.transitionPolicy.assertOriginCheckIn(shipment.status);
      const currentPkg = shipment.packageSnapshot as unknown as PackageSnapshot;
      const updatedPackageSnapshot = {
        ...currentPkg,
        verifiedWeightGrams: dto.actualWeightGrams,
        verifiedDimensions: {
          lengthCm: dto.lengthCm,
          widthCm: dto.widthCm,
          heightCm: dto.heightCm,
        },
        verifiedAt: new Date().toISOString(),
        verifiedByStaffId: actor.id,
      };

      const updatedShipment = await this.prisma.$transaction(async (transaction) => {
        await this.updateShipmentConditionally(transaction, shipment, {
          status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
          originWarehouseId: expectedOriginWarehouseId,
          currentWarehouseId: warehouse.id,
          packageSnapshot: updatedPackageSnapshot,
          version: { increment: 1 },
        });
        await transaction.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
            type: 'WAREHOUSE_ORIGIN_CHECK_IN',
            title: 'Đã nhập kho xuất phát',
            description: `Kiện hàng đã nhập kho ${warehouse.name} (${warehouse.code}).${
              dto.note ? ` Ghi chú: ${dto.note}` : ''
            }`,
            visibility: TrackingVisibility.PUBLIC,
            actorId: actor.id,
            warehouseId: warehouse.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'WAREHOUSE_ORIGIN_CHECK_IN',
            entityType: 'SHIPMENT',
            entityId: shipment.id,
            before: {
              status: shipment.status,
              currentWarehouseId: shipment.currentWarehouseId,
            },
            after: {
              status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
              originWarehouseId: expectedOriginWarehouseId,
              currentWarehouseId: warehouse.id,
              verifiedWeightGrams: dto.actualWeightGrams,
            },
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
        await this.notifications.createIdempotent(transaction, [
          {
            userId: shipment.customerId,
            eventKey: `shipment:${shipment.id}:warehouse-origin:${warehouse.id}`,
            type: 'WAREHOUSE_ARRIVED',
            title: 'Đã đến kho xuất phát',
            message: `${shipment.trackingCode} đã đến kho ${warehouse.name}.`,
            data: { shipmentId: shipment.id, warehouseId: warehouse.id },
          },
        ]);
        return transaction.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
          include: warehouseShipmentInclude,
        });
      });

      await this.notifications.publishByEventKeys([
        `shipment:${shipment.id}:warehouse-origin:${warehouse.id}`,
      ]);
      await this.notifications.publishShipmentUpdated(
        shipment.id,
        ShipmentStatus.AT_ORIGIN_WAREHOUSE,
      );

      return {
        idempotent: false,
        shipment: this.serializeShipment(updatedShipment),
      };
    }

    throw new ConflictException({
      code: 'INVALID_SHIPMENT_STATUS_FOR_CHECK_IN',
      message: `Cannot check in shipment in status "${shipment.status}". Expected PICKED_UP.`,
    });
  }

  // ==========================================
  // DESTINATION ROUTING & DELIVERY READINESS
  // ==========================================

  async routeDestination(
    warehouseId: string,
    shipmentId: string,
    dto: RouteDestinationDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: warehouseShipmentInclude,
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment not found',
      });
    }

    if (shipment.currentWarehouseId !== warehouseId) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_IN_WAREHOUSE',
        message: 'Shipment is not currently located in this warehouse',
      });
    }

    if (
      shipment.destinationWarehouseId === dto.destinationWarehouseId &&
      (shipment.status === ShipmentStatus.AT_ORIGIN_WAREHOUSE ||
        shipment.status === ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT)
    ) {
      return this.serializeShipment(shipment);
    }

    this.transitionPolicy.assertDestinationRoutable(shipment.status);

    const activeTransfer = await this.prisma.warehouseTransfer.findFirst({
      where: {
        shipmentId,
        status: { in: [WarehouseTransferStatus.PENDING, WarehouseTransferStatus.IN_TRANSIT] },
      },
    });
    if (activeTransfer) {
      throw new ConflictException({
        code: 'ACTIVE_TRANSFER_EXISTS',
        message: 'Destination cannot change while an active warehouse transfer exists',
      });
    }

    const targetWarehouse = await this.prisma.warehouse.findUnique({
      where: { id: dto.destinationWarehouseId },
    });
    if (!targetWarehouse || !targetWarehouse.isActive) {
      throw new NotFoundException({
        code: 'DESTINATION_WAREHOUSE_NOT_FOUND',
        message: 'Destination warehouse not found or inactive',
      });
    }

    const isIntraWarehouse = dto.destinationWarehouseId === warehouseId;
    const nextStatus = isIntraWarehouse
      ? ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT
      : shipment.status;

    const updatedShipment = await this.prisma.$transaction(async (transaction) => {
      await this.updateShipmentConditionally(transaction, shipment, {
        destinationWarehouseId: dto.destinationWarehouseId,
        status: nextStatus,
        version: { increment: 1 },
      });
      if (isIntraWarehouse) {
        await transaction.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
            type: 'AWAITING_DELIVERY_ASSIGNMENT',
            title: 'Sẵn sàng điều phối giao hàng',
            description: `Kiện hàng cùng khu vực kho ${targetWarehouse.name}, sẵn sàng chuyển sang điều phối giao hàng.`,
            visibility: TrackingVisibility.PUBLIC,
            actorId: actor.id,
            warehouseId,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'SHIPMENT_DESTINATION_ROUTED',
          entityType: 'SHIPMENT',
          entityId: shipment.id,
          before: {
            destinationWarehouseId: shipment.destinationWarehouseId,
            status: shipment.status,
          },
          after: {
            destinationWarehouseId: dto.destinationWarehouseId,
            status: nextStatus,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return transaction.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        include: warehouseShipmentInclude,
      });
    });

    await this.notifications.publishShipmentUpdated(shipment.id, nextStatus);

    return this.serializeShipment(updatedShipment);
  }

  async markReadyForDelivery(
    warehouseId: string,
    shipmentId: string,
    actor: AuthenticatedUser,
    context: ClientContext,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);

    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: warehouseShipmentInclude,
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment not found',
      });
    }

    if (shipment.currentWarehouseId !== warehouseId) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_IN_WAREHOUSE',
        message: 'Shipment is not currently located in this warehouse',
      });
    }

    if (shipment.status === ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT) {
      return this.serializeShipment(shipment);
    }

    if (
      shipment.status === ShipmentStatus.AT_ORIGIN_WAREHOUSE &&
      shipment.destinationWarehouseId !== warehouseId
    ) {
      throw new ConflictException({
        code: shipment.destinationWarehouseId
          ? 'WAREHOUSE_TRANSFER_REQUIRED'
          : 'DESTINATION_WAREHOUSE_REQUIRED',
        message: shipment.destinationWarehouseId
          ? 'Shipment must be transferred to its destination warehouse before delivery readiness'
          : 'Sort and confirm the destination warehouse before delivery readiness',
      });
    }

    this.transitionPolicy.assertReadyForDelivery(shipment.status);

    const updatedShipment = await this.prisma.$transaction(async (transaction) => {
      await this.updateShipmentConditionally(transaction, shipment, {
        status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
        version: { increment: 1 },
      });
      await transaction.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
          type: 'AWAITING_DELIVERY_ASSIGNMENT',
          title: 'Sẵn sàng giao hàng',
          description: `Kiện hàng đã hoàn tất xử lý tại kho ${warehouse.name} (${warehouse.code}) và đang chờ phân công tài xế giao hàng.`,
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
          warehouseId: warehouse.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'SHIPMENT_READY_FOR_DELIVERY',
          entityType: 'SHIPMENT',
          entityId: shipment.id,
          before: { status: shipment.status },
          after: { status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return transaction.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        include: warehouseShipmentInclude,
      });
    });

    await this.notifications.publishShipmentUpdated(
      shipment.id,
      ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
    );

    return this.serializeShipment(updatedShipment);
  }

  // ==========================================
  // WAREHOUSE TRANSFERS (DISPATCH & RECEIVE)
  // ==========================================

  async createTransfer(
    warehouseId: string,
    dto: CreateTransferDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseTransferResponse> {
    await this.assertStaffWarehouseScope(actor, warehouseId);

    // Idempotency check C09
    const existing = await this.prisma.warehouseTransfer.findUnique({
      where: {
        createdById_clientRequestId: {
          createdById: actor.id,
          clientRequestId: dto.clientRequestId,
        },
      },
      include: warehouseTransferResponseInclude,
    });
    if (existing) {
      this.assertTransferIdempotency(existing, warehouseId, dto);
      return toWarehouseTransferResponse(existing);
    }

    const activeTransfer = await this.prisma.warehouseTransfer.findFirst({
      where: {
        shipmentId: dto.shipmentId,
        status: { in: [WarehouseTransferStatus.PENDING, WarehouseTransferStatus.IN_TRANSIT] },
      },
      include: warehouseTransferResponseInclude,
    });
    if (activeTransfer) {
      this.assertActiveTransferMatches(activeTransfer, warehouseId, dto);
      return toWarehouseTransferResponse(activeTransfer);
    }

    if (dto.toWarehouseId === warehouseId) {
      throw new BadRequestException({
        code: 'TRANSFER_SAME_WAREHOUSE',
        message: 'Destination warehouse cannot be the same as the origin warehouse',
      });
    }

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: warehouseId } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.toWarehouseId } }),
    ]);

    if (!fromWarehouse || !fromWarehouse.isActive) {
      throw new NotFoundException({
        code: 'ORIGIN_WAREHOUSE_NOT_FOUND',
        message: 'Origin warehouse not found or inactive',
      });
    }
    if (!toWarehouse || !toWarehouse.isActive) {
      throw new NotFoundException({
        code: 'DESTINATION_WAREHOUSE_NOT_FOUND',
        message: 'Destination warehouse not found or inactive',
      });
    }

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: dto.shipmentId },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment not found',
      });
    }

    if (shipment.currentWarehouseId !== warehouseId) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_AT_ORIGIN_WAREHOUSE',
        message: 'Shipment is not currently located at this warehouse',
      });
    }

    this.transitionPolicy.assertTransferCreatable(shipment.status);

    if (!shipment.destinationWarehouseId) {
      throw new ConflictException({
        code: 'DESTINATION_WAREHOUSE_REQUIRED',
        message: 'Sort and confirm the destination warehouse before creating a transfer',
      });
    }
    if (shipment.destinationWarehouseId !== dto.toWarehouseId) {
      throw new ConflictException({
        code: 'TRANSFER_DESTINATION_MISMATCH',
        message: 'Transfer destination must match the shipment sorting destination',
      });
    }

    const transferCode = `TRF-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    let transfer: Prisma.WarehouseTransferGetPayload<{
      include: typeof warehouseTransferResponseInclude;
    }>;
    try {
      transfer = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.warehouseTransfer.create({
          data: {
            transferCode,
            shipmentId: shipment.id,
            fromWarehouseId: warehouseId,
            toWarehouseId: dto.toWarehouseId,
            status: WarehouseTransferStatus.PENDING,
            note: dto.note?.trim() || null,
            clientRequestId: dto.clientRequestId,
            createdById: actor.id,
          },
          include: warehouseTransferResponseInclude,
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'WAREHOUSE_TRANSFER_CREATED',
            entityType: 'WAREHOUSE_TRANSFER',
            entityId: created.id,
            after: {
              transferCode,
              shipmentId: shipment.id,
              fromWarehouseId: warehouseId,
              toWarehouseId: dto.toWarehouseId,
              status: WarehouseTransferStatus.PENDING,
            },
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
        return created;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const committedByRequest = await this.prisma.warehouseTransfer.findUnique({
        where: {
          createdById_clientRequestId: {
            createdById: actor.id,
            clientRequestId: dto.clientRequestId,
          },
        },
        include: warehouseTransferResponseInclude,
      });
      const committed =
        committedByRequest ??
        (await this.prisma.warehouseTransfer.findFirst({
          where: {
            shipmentId: dto.shipmentId,
            status: { in: [WarehouseTransferStatus.PENDING, WarehouseTransferStatus.IN_TRANSIT] },
          },
          include: warehouseTransferResponseInclude,
        }));
      if (!committed) {
        throw new ConflictException({
          code: 'WAREHOUSE_TRANSFER_CONFLICT',
          message: 'Transfer changed concurrently; reload and try again',
        });
      }
      this.assertActiveTransferMatches(committed, warehouseId, dto);
      transfer = committed;
    }

    return toWarehouseTransferResponse(transfer);
  }

  async dispatchTransfer(
    warehouseId: string,
    transferId: string,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseTransferResponse> {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const result = await this.prisma.$transaction((transaction) =>
      this.transferLifecycle.dispatch(transaction, {
        warehouseId,
        transferId,
        actor,
        context,
      }),
    );

    if (result.transitioned) {
      await this.notifications.publishShipmentUpdated(
        result.transfer.shipmentId,
        ShipmentStatus.IN_TRANSIT,
      );
    }
    return toWarehouseTransferResponse(result.transfer);
  }

  async receiveTransfer(
    warehouseId: string,
    transferId: string,
    dto: ReceiveTransferDto,
    actor: AuthenticatedUser,
    context: ClientContext,
  ): Promise<WarehouseTransferResponse> {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const result = await this.prisma.$transaction((transaction) =>
      this.transferLifecycle.receive(transaction, {
        warehouseId,
        transferId,
        dto,
        actor,
        context,
      }),
    );
    if (result.transitioned) {
      await this.notifications.publishByEventKeys([
        `shipment:${result.transfer.shipmentId}:warehouse-destination:${warehouseId}`,
      ]);
      await this.notifications.publishShipmentUpdated(
        result.transfer.shipmentId,
        ShipmentStatus.AT_DESTINATION_WAREHOUSE,
      );
    }
    return toWarehouseTransferResponse(result.transfer);
  }

  // ==========================================
  // INVENTORY & SHIPMENT QUERIES
  // ==========================================

  async listWarehouseShipments(
    warehouseId: string,
    query: ListWarehouseShipmentsDto,
    actor: AuthenticatedUser,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const search = query.search?.trim();
    const where: Prisma.ShipmentWhereInput = {
      currentWarehouseId: warehouseId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { trackingCode: { contains: search, mode: 'insensitive' } },
              { customer: { fullName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const items = await this.prisma.shipment.findMany({
      where,
      include: warehouseShipmentInclude,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.shipment.count({ where });

    return {
      items: items.map((shipment) => this.serializeShipment(shipment)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async listExceptions(
    warehouseId: string,
    query: ListWarehouseExceptionsDto,
    actor: AuthenticatedUser,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const exceptionStatuses = [ShipmentStatus.DAMAGED, ShipmentStatus.LOST];
    const where: Prisma.ShipmentWhereInput = {
      currentWarehouseId: warehouseId,
      status:
        query.status === ShipmentStatus.DAMAGED || query.status === ShipmentStatus.LOST
          ? query.status
          : { in: exceptionStatuses },
      ...(query.fromDate || toDateExclusive
        ? {
            updatedAt: {
              ...(query.fromDate ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { trackingCode: { contains: search, mode: 'insensitive' } },
              { customer: { fullName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [shipments, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: warehouseShipmentInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return {
      items: shipments.map((shipment) => this.serializeShipment(shipment)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listTransfers(
    warehouseId: string,
    direction: 'inbound' | 'outbound' | 'all' = 'all',
    actor: AuthenticatedUser,
  ): Promise<WarehouseTransferResponse[]> {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const where: Prisma.WarehouseTransferWhereInput =
      direction === 'inbound'
        ? { toWarehouseId: warehouseId }
        : direction === 'outbound'
          ? { fromWarehouseId: warehouseId }
          : { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] };

    const transfers = await this.prisma.warehouseTransfer.findMany({
      where,
      include: warehouseTransferResponseInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return transfers.map(toWarehouseTransferResponse);
  }

  // ==========================================
  // INBOUND QUEUE (PICKED UP SHIPMENTS & INBOUND TRANSFERS)
  // ==========================================

  async listInboundQueue(warehouseId: string, actor: AuthenticatedUser) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const [incomingTransfers, pickedUpShipments] = await Promise.all([
      this.prisma.warehouseTransfer.findMany({
        where: {
          toWarehouseId: warehouseId,
          status: WarehouseTransferStatus.IN_TRANSIT,
        },
        include: warehouseTransferResponseInclude,
        orderBy: { dispatchedAt: 'asc' },
      }),
      this.prisma.shipment.findMany({
        where: {
          status: ShipmentStatus.PICKED_UP,
          OR: [
            { originWarehouseId: warehouseId },
            {
              originWarehouseId: null,
              driverAssignments: {
                some: {
                  type: 'PICKUP',
                  status: 'COMPLETED',
                  driver: { operatingWarehouseId: warehouseId },
                },
              },
            },
          ],
        },
        include: warehouseShipmentInclude,
        orderBy: { pickedUpAt: 'asc' },
        take: 50,
      }),
    ]);

    return {
      incomingTransfers: incomingTransfers.map(toWarehouseTransferResponse),
      pickedUpShipments: pickedUpShipments.map((shipment) => this.serializeShipment(shipment)),
    };
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  private async requireActiveWarehouse(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || !warehouse.isActive) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found or inactive',
      });
    }
    return warehouse;
  }

  private async findWarehouseShipment(input: { shipmentId?: string; trackingCode?: string }) {
    if (!input.shipmentId && !input.trackingCode?.trim()) {
      throw new BadRequestException({
        code: 'SHIPMENT_IDENTIFIER_REQUIRED',
        message: 'Tracking code or shipment ID is required',
      });
    }
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        OR: [
          ...(input.shipmentId ? [{ id: input.shipmentId }] : []),
          ...(input.trackingCode
            ? [{ trackingCode: input.trackingCode.trim().toUpperCase() }]
            : []),
        ],
      },
      include: warehouseShipmentInclude,
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment not found with given tracking code or ID',
      });
    }
    return shipment;
  }

  private assertExpectedOriginWarehouse(shipment: WarehouseShipment, warehouseId: string): string {
    const expectedOriginWarehouseId =
      shipment.originWarehouseId ??
      shipment.driverAssignments[0]?.driver.operatingWarehouseId ??
      null;
    if (!expectedOriginWarehouseId) {
      throw new ConflictException({
        code: 'ORIGIN_WAREHOUSE_REQUIRED',
        message: 'Shipment has no authoritative origin warehouse from its pickup assignment',
      });
    }
    if (expectedOriginWarehouseId !== warehouseId) {
      throw new ForbiddenException({
        code: 'ORIGIN_WAREHOUSE_MISMATCH',
        message: 'Only the shipment origin warehouse can perform origin check-in',
      });
    }
    return expectedOriginWarehouseId;
  }

  async receiveReturn(
    warehouseId: string,
    shipmentId: string,
    dto: { note?: string },
    actor: AuthenticatedUser,
    context: ClientContext,
  ) {
    await this.assertStaffWarehouseScope(actor, warehouseId);
    const result = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
      if (!shipment)
        throw new NotFoundException({
          code: 'SHIPMENT_NOT_FOUND',
          message: 'Shipment was not found',
        });
      if (shipment.returnWarehouseId !== warehouseId)
        throw new ForbiddenException({
          code: 'RETURN_DESTINATION_MISMATCH',
          message: 'Cannot receive a return addressed to another warehouse',
        });
      if (shipment.status === ShipmentStatus.RETURNED) return shipment;
      this.transitionPolicy.assertReturnReceivable(shipment.status);
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse?.isActive)
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: 'Receiving warehouse not found or inactive',
        });
      const update = await tx.shipment.updateMany({
        where: {
          id: shipment.id,
          status: ShipmentStatus.RETURN_IN_TRANSIT,
          version: shipment.version,
        },
        data: {
          status: ShipmentStatus.RETURNED,
          currentWarehouseId: warehouseId,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1)
        throw new ConflictException({
          code: 'SHIPMENT_CONCURRENT_MODIFICATION',
          message: 'Shipment changed concurrently; reload and try again',
        });
      await tx.trackingEvent.create({
        data: {
          shipmentId,
          status: ShipmentStatus.RETURNED,
          type: 'RETURNED',
          title: 'Đã nhận hàng hoàn',
          description: dto.note?.trim() || null,
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
          warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'RETURN_RECEIVED',
          entityType: 'Shipment',
          entityId: shipmentId,
          before: { status: shipment.status, version: shipment.version },
          after: {
            status: ShipmentStatus.RETURNED,
            currentWarehouseId: warehouseId,
            version: shipment.version + 1,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    });
    await this.notifications.publishShipmentUpdated(shipmentId, ShipmentStatus.RETURNED);
    return result;
  }

  private async assertStaffWarehouseScope(
    actor: AuthenticatedUser,
    warehouseId: string,
  ): Promise<void> {
    const staffWarehouseId = await this.resolveStaffWarehouseId(actor);
    if (staffWarehouseId && staffWarehouseId !== warehouseId) {
      throw new ForbiddenException({
        code: 'WAREHOUSE_SCOPE_FORBIDDEN',
        message: 'You are not assigned to or active in this warehouse',
      });
    }
  }

  private async resolveStaffWarehouseId(actor: AuthenticatedUser): Promise<string | null> {
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.DISPATCHER) return null;
    if (actor.role === UserRole.WAREHOUSE_STAFF) {
      const profile = await this.prisma.warehouseStaffProfile.findUnique({
        where: { userId: actor.id },
      });
      if (profile?.isActive) return profile.warehouseId;
      throw new ForbiddenException({
        code: 'WAREHOUSE_SCOPE_FORBIDDEN',
        message: 'You are not assigned to or active in a warehouse',
      });
    }
    throw new ForbiddenException({
      code: 'UNAUTHORIZED_ROLE',
      message: 'Access denied',
    });
  }

  private async updateShipmentConditionally(
    transaction: Prisma.TransactionClient,
    shipment: { id: string; status: ShipmentStatus; version: number },
    data: Prisma.ShipmentUncheckedUpdateManyInput,
  ): Promise<void> {
    const result = await transaction.shipment.updateMany({
      where: {
        id: shipment.id,
        status: shipment.status,
        version: shipment.version,
      },
      data,
    });
    this.assertConcurrentUpdate(result.count, 'Shipment');
  }

  private assertConcurrentUpdate(
    count: number,
    entity: 'Shipment' | 'Transfer' | 'Warehouse' | 'WarehouseStaffProfile',
  ): void {
    if (count !== 1) {
      throw new ConflictException({
        code: `${entity.toUpperCase()}_CONCURRENT_MODIFICATION`,
        message: `${entity} changed concurrently; reload and try again`,
      });
    }
  }

  private assertTransferIdempotency(
    transfer: { shipmentId: string; fromWarehouseId: string; toWarehouseId: string },
    warehouseId: string,
    dto: CreateTransferDto,
  ): void {
    if (
      transfer.shipmentId !== dto.shipmentId ||
      transfer.fromWarehouseId !== warehouseId ||
      transfer.toWarehouseId !== dto.toWarehouseId
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'The idempotency key was already used for another warehouse transfer',
      });
    }
  }

  private assertActiveTransferMatches(
    transfer: { shipmentId: string; fromWarehouseId: string; toWarehouseId: string },
    warehouseId: string,
    dto: CreateTransferDto,
  ): void {
    if (
      transfer.shipmentId !== dto.shipmentId ||
      transfer.fromWarehouseId !== warehouseId ||
      transfer.toWarehouseId !== dto.toWarehouseId
    ) {
      throw new ConflictException({
        code: 'ACTIVE_TRANSFER_EXISTS',
        message: 'Shipment already has another active warehouse transfer',
      });
    }
  }

  private serializeShipment(shipment: WarehouseShipment) {
    return {
      id: shipment.id,
      trackingCode: shipment.trackingCode,
      status: shipment.status,
      totalFee: shipment.totalFee,
      codAmount: shipment.codAmount,
      originWarehouseId: shipment.originWarehouseId,
      destinationWarehouseId: shipment.destinationWarehouseId,
      currentWarehouseId: shipment.currentWarehouseId,
      senderSnapshot: shipment.senderSnapshot,
      receiverSnapshot: shipment.receiverSnapshot,
      pickupSnapshot: shipment.pickupSnapshot,
      deliverySnapshot: shipment.deliverySnapshot,
      packageSnapshot: shipment.packageSnapshot,
      pricingSnapshot: shipment.pricingSnapshot,
      confirmedAt: shipment.confirmedAt?.toISOString?.() ?? shipment.confirmedAt,
      pickedUpAt: shipment.pickedUpAt?.toISOString?.() ?? shipment.pickedUpAt,
      createdAt: shipment.createdAt?.toISOString?.() ?? shipment.createdAt,
      updatedAt: shipment.updatedAt?.toISOString?.() ?? shipment.updatedAt,
      customer: shipment.customer,
      originWarehouse: shipment.originWarehouse,
      destinationWarehouse: shipment.destinationWarehouse,
      currentWarehouse: shipment.currentWarehouse,
      driverAssignments: shipment.driverAssignments?.map((assignment) => ({
        id: assignment.id,
        shipmentId: assignment.shipmentId,
        driverId: assignment.driverId,
        type: assignment.type,
        status: assignment.status,
        assignedAt: assignment.assignedAt,
        acceptedAt: assignment.acceptedAt,
        completedAt: assignment.completedAt,
        driver: {
          id: assignment.driver.id,
          operatingWarehouseId: assignment.driver.operatingWarehouseId,
          employeeCode: assignment.driver.employeeCode,
          vehicleType: assignment.driver.vehicleType,
          vehiclePlate: assignment.driver.vehiclePlate,
          user: {
            id: assignment.driver.user.id,
            fullName: assignment.driver.user.fullName,
            phone: assignment.driver.user.phone,
          },
        },
      })),
    };
  }
}
