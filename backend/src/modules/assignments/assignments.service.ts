import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShipmentProofType,
  ShipmentStatus,
  TrackingVisibility,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AssignPickupDriverDto } from './dto/assign-pickup-driver.dto.js';
import type { ListDriverAssignmentsDto } from './dto/list-driver-assignments.dto.js';
import {
  OperationalShipmentView,
  type ListOperationalShipmentsDto,
} from './dto/list-operational-shipments.dto.js';
import type { PickupShipmentDto } from './dto/pickup-shipment.dto.js';
import type { ReassignPickupDriverDto } from './dto/reassign-pickup-driver.dto.js';
import type { RejectAssignmentDto } from './dto/reject-assignment.dto.js';
import { activeAssignmentStatuses } from './assignment.policy.js';
import { AssignmentCandidatesService } from './assignment-candidates.service.js';
import {
  toAssignmentResponse,
  type AssignmentResponse,
  type AssignmentWithDetails,
} from './assignment.response.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import { DriverTaskOwnershipService } from './driver-task-ownership.service.js';
import type {
  AddressSnapshot,
  ContactSnapshot,
  PackageSnapshot,
} from '../shipments/shipment.response.js';
import { toShippingFeeTransactionResponse } from '../shipping-fees/shipping-fee.response.js';
import { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';

const assignmentInclude = {
  shipment: { include: { shippingFeeTransaction: true } },
  driver: { include: { user: true } },
  proof: true,
} satisfies Prisma.DriverAssignmentInclude;

const operationalShipmentInclude = {
  customer: { select: { fullName: true, phone: true } },
  originWarehouse: { select: { id: true, code: true, name: true } },
  destinationWarehouse: { select: { id: true, code: true, name: true } },
  currentWarehouse: { select: { id: true, code: true, name: true } },
  returnWarehouse: { select: { id: true, code: true, name: true } },
  driverAssignments: {
    include: { driver: { include: { user: true } } },
    orderBy: { assignedAt: 'desc' },
    take: 10,
  },
  deliveryAttempts: {
    include: { proof: true },
    orderBy: { attemptNumber: 'desc' },
    take: 1,
  },
  shippingFeeTransaction: true,
} satisfies Prisma.ShipmentInclude;

type OperationalShipmentRecord = Prisma.ShipmentGetPayload<{
  include: typeof operationalShipmentInclude;
}>;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitionPolicy: ShipmentTransitionPolicy,
    private readonly candidates: AssignmentCandidatesService,
    private readonly notifications: NotificationsService,
    private readonly driverOwnership: DriverTaskOwnershipService,
    private readonly shippingFees: ShippingFeesService,
  ) {}

  listPickupCandidates(shipmentId: string) {
    return this.candidates.listPickup(shipmentId);
  }

  async listOperationalShipments(query: ListOperationalShipmentsDto) {
    const view = query.view ?? OperationalShipmentView.PICKUP;
    const statusesByView: Record<
      Exclude<OperationalShipmentView, OperationalShipmentView.ALL>,
      ShipmentStatus[]
    > = {
      [OperationalShipmentView.PICKUP]: [
        ShipmentStatus.PENDING,
        ShipmentStatus.CONFIRMED,
        ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
        ShipmentStatus.PICKUP_ASSIGNED,
        ShipmentStatus.PICKUP_IN_PROGRESS,
        ShipmentStatus.PICKED_UP,
      ],
      [OperationalShipmentView.DELIVERY]: [
        ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
        ShipmentStatus.DELIVERY_ASSIGNED,
        ShipmentStatus.OUT_FOR_DELIVERY,
        ShipmentStatus.DELIVERY_FAILED,
      ],
      [OperationalShipmentView.FAILED]: [ShipmentStatus.DELIVERY_FAILED],
      [OperationalShipmentView.RETURNS]: [
        ShipmentStatus.RETURN_REQUESTED,
        ShipmentStatus.RETURN_IN_TRANSIT,
        ShipmentStatus.RETURNED,
      ],
      [OperationalShipmentView.EXCEPTIONS]: [ShipmentStatus.DAMAGED, ShipmentStatus.LOST],
    };
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const viewStatuses = view === OperationalShipmentView.ALL ? undefined : statusesByView[view];
    const where: Prisma.ShipmentWhereInput = {
      ...(query.status
        ? { status: query.status }
        : viewStatuses
          ? { status: { in: viewStatuses } }
          : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.driverId ? { driverAssignments: { some: { driverId: query.driverId } } } : {}),
      ...(query.warehouseId
        ? {
            OR: [
              { originWarehouseId: query.warehouseId },
              { destinationWarehouseId: query.warehouseId },
              { currentWarehouseId: query.warehouseId },
              { returnWarehouseId: query.warehouseId },
            ],
          }
        : {}),
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
            AND: [
              {
                OR: [
                  { trackingCode: { contains: search, mode: 'insensitive' } },
                  { customer: { fullName: { contains: search, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };
    const shipments = await this.prisma.shipment.findMany({
      where,
      include: operationalShipmentInclude,
      orderBy: { createdAt: view === OperationalShipmentView.ALL ? 'desc' : 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.shipment.count({ where });
    return {
      items: shipments.map((shipment) => this.toOperationalShipment(shipment)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getOperationalShipment(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: operationalShipmentInclude,
    });
    if (!shipment) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
    return this.toOperationalShipment(shipment);
  }

  async confirmShipment(actor: AuthenticatedUser, shipmentId: string, context: ClientContext) {
    const shipment = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.shipment.findUnique({ where: { id: shipmentId } });
      if (!current) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
      if (current.status === ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT && current.confirmedAt) {
        return current;
      }
      this.transitionPolicy.assertConfirmable(current.status);
      const confirmedAt = current.confirmedAt ?? new Date();
      const update = await transaction.shipment.updateMany({
        where: { id: current.id, status: current.status, version: current.version },
        data: {
          status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
          confirmedAt,
          version: { increment: 1 },
        },
      });
      this.assertUpdated(update.count);

      if (current.status === ShipmentStatus.PENDING) {
        await transaction.trackingEvent.create({
          data: {
            shipmentId: current.id,
            status: ShipmentStatus.CONFIRMED,
            type: 'SHIPMENT_CONFIRMED',
            title: 'Đã xác nhận vận đơn',
            description: 'Thông tin vận đơn đã được điều phối xác nhận.',
            visibility: TrackingVisibility.PUBLIC,
            actorId: actor.id,
            createdAt: confirmedAt,
          },
        });
      }
      await transaction.trackingEvent.create({
        data: {
          shipmentId: current.id,
          status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
          type: 'AWAITING_PICKUP_ASSIGNMENT',
          title: 'Đang chờ phân công lấy hàng',
          description: 'Vận đơn đang chờ tài xế nhận nhiệm vụ lấy hàng.',
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'SHIPMENT_CONFIRM',
          entityType: 'Shipment',
          entityId: current.id,
          before: { status: current.status, version: current.version },
          after: {
            status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
            version: current.version + 1,
            confirmedAt,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      await this.notifications.createIdempotent(transaction, [
        {
          userId: current.customerId,
          eventKey: `shipment:${current.id}:confirmed`,
          type: 'SHIPMENT_CONFIRMED',
          title: 'Vận đơn đã được xác nhận',
          message: `${current.trackingCode} đang chờ phân công tài xế lấy hàng.`,
          data: { shipmentId: current.id, trackingCode: current.trackingCode },
        },
      ]);
      return transaction.shipment.findUniqueOrThrow({ where: { id: current.id } });
    });
    await this.notifications.publishByEventKeys([`shipment:${shipmentId}:confirmed`]);
    await this.notifications.publishShipmentUpdated(
      shipmentId,
      ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
    );
    return shipment;
  }

  assignPickup(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: AssignPickupDriverDto,
    context: ClientContext,
  ): Promise<AssignmentResponse> {
    return this.assign(actor, shipmentId, dto, context, false);
  }

  reassignPickup(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: ReassignPickupDriverDto,
    context: ClientContext,
  ): Promise<AssignmentResponse> {
    return this.assign(actor, shipmentId, dto, context, true);
  }

  async listMine(userId: string, query: ListDriverAssignmentsDto) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const where: Prisma.DriverAssignmentWhereInput = {
      driverId: profile.id,
      type: DriverAssignmentType.PICKUP,
      ...(query.status ? { status: query.status } : {}),
      ...(query.fromDate || toDateExclusive
        ? {
            assignedAt: {
              ...(query.fromDate ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(search ? { shipment: { trackingCode: { contains: search, mode: 'insensitive' } } } : {}),
    };
    const assignments = await this.prisma.driverAssignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: { assignedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.driverAssignment.count({ where });
    return {
      items: assignments.map(toAssignmentResponse),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getMine(userId: string, assignmentId: string): Promise<AssignmentResponse> {
    const assignment = await this.prisma.driverAssignment.findFirst({
      where: {
        id: assignmentId,
        type: DriverAssignmentType.PICKUP,
        driver: { userId },
      },
      include: assignmentInclude,
    });
    if (!assignment) throw this.notFound('ASSIGNMENT_NOT_FOUND', 'Assignment was not found');
    return toAssignmentResponse(assignment);
  }

  async accept(
    actor: AuthenticatedUser,
    assignmentId: string,
    context: ClientContext,
  ): Promise<AssignmentResponse> {
    const assignment = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: assignmentInclude,
      });
      this.assertOwnership(current, actor.id);
      if (
        (current.status === DriverAssignmentStatus.ACCEPTED &&
          current.shipment.status === ShipmentStatus.PICKUP_IN_PROGRESS) ||
        (current.status === DriverAssignmentStatus.COMPLETED &&
          current.shipment.status === ShipmentStatus.PICKED_UP)
      ) {
        return current;
      }
      if (current.status !== DriverAssignmentStatus.PENDING) {
        throw this.assignmentStateConflict(current.status, 'accept');
      }
      this.transitionPolicy.assertAcceptable(current.shipment.status);
      const acceptedAt = new Date();
      const assignmentUpdate = await transaction.driverAssignment.updateMany({
        where: { id: current.id, status: DriverAssignmentStatus.PENDING },
        data: { status: DriverAssignmentStatus.ACCEPTED, acceptedAt },
      });
      this.assertUpdated(assignmentUpdate.count);
      const shipmentUpdate = await transaction.shipment.updateMany({
        where: {
          id: current.shipmentId,
          status: ShipmentStatus.PICKUP_ASSIGNED,
          version: current.shipment.version,
        },
        data: { status: ShipmentStatus.PICKUP_IN_PROGRESS, version: { increment: 1 } },
      });
      this.assertUpdated(shipmentUpdate.count);
      await transaction.trackingEvent.create({
        data: {
          shipmentId: current.shipmentId,
          status: ShipmentStatus.PICKUP_IN_PROGRESS,
          type: 'PICKUP_IN_PROGRESS',
          title: 'Tài xế đang đến lấy hàng',
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'PICKUP_ASSIGNMENT_ACCEPT',
          entityType: 'DriverAssignment',
          entityId: current.id,
          before: { assignmentStatus: current.status, shipmentStatus: current.shipment.status },
          after: {
            assignmentStatus: DriverAssignmentStatus.ACCEPTED,
            shipmentStatus: ShipmentStatus.PICKUP_IN_PROGRESS,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      await this.notifications.createIdempotent(transaction, [
        {
          userId: current.shipment.customerId,
          eventKey: `assignment:${current.id}:accepted`,
          type: 'PICKUP_IN_PROGRESS',
          title: 'Tài xế đang đến lấy hàng',
          message: `${current.shipment.trackingCode} đã được tài xế tiếp nhận.`,
          data: { shipmentId: current.shipmentId, assignmentId: current.id },
        },
      ]);
      return transaction.driverAssignment.findUniqueOrThrow({
        where: { id: current.id },
        include: assignmentInclude,
      });
    });
    await this.notifications.publishByEventKeys([`assignment:${assignment.id}:accepted`]);
    await this.notifications.publishShipmentUpdated(
      assignment.shipmentId,
      ShipmentStatus.PICKUP_IN_PROGRESS,
    );
    return toAssignmentResponse(assignment);
  }

  async reject(
    actor: AuthenticatedUser,
    assignmentId: string,
    dto: RejectAssignmentDto,
    context: ClientContext,
  ): Promise<AssignmentResponse> {
    const assignment = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: assignmentInclude,
      });
      this.assertOwnership(current, actor.id);
      if (
        current.status === DriverAssignmentStatus.REJECTED &&
        current.shipment.status === ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT
      ) {
        return current;
      }
      if (!activeAssignmentStatuses.includes(current.status)) {
        throw this.assignmentStateConflict(current.status, 'reject');
      }
      this.transitionPolicy.assertRejectable(current.shipment.status);
      const reason = dto.reason.trim();
      const rejectedAt = new Date();
      const assignmentUpdate = await transaction.driverAssignment.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: DriverAssignmentStatus.REJECTED,
          rejectedAt,
          reason,
        },
      });
      this.assertUpdated(assignmentUpdate.count);
      const shipmentUpdate = await transaction.shipment.updateMany({
        where: {
          id: current.shipmentId,
          status: current.shipment.status,
          version: current.shipment.version,
        },
        data: {
          status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
          version: { increment: 1 },
        },
      });
      this.assertUpdated(shipmentUpdate.count);
      await this.updateDriverConditionally(
        transaction,
        current.driver,
        current.driver.user.status === UserStatus.ACTIVE &&
          current.driver.status !== DriverStatus.SUSPENDED &&
          current.driver.isOnline
          ? { status: DriverStatus.AVAILABLE, isAvailable: true }
          : current.driver.status === DriverStatus.SUSPENDED
            ? { status: DriverStatus.SUSPENDED, isOnline: false, isAvailable: false }
            : { status: DriverStatus.OFFLINE, isOnline: false, isAvailable: false },
      );
      await transaction.trackingEvent.create({
        data: {
          shipmentId: current.shipmentId,
          status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
          type: 'AWAITING_PICKUP_REASSIGNMENT',
          title: 'Đang chờ phân công lại tài xế',
          description: 'Bộ phận điều phối đang chọn tài xế lấy hàng khác.',
          visibility: TrackingVisibility.PUBLIC,
          actorId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'PICKUP_ASSIGNMENT_REJECT',
          entityType: 'DriverAssignment',
          entityId: current.id,
          before: { assignmentStatus: current.status, shipmentStatus: current.shipment.status },
          after: {
            assignmentStatus: DriverAssignmentStatus.REJECTED,
            shipmentStatus: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
          },
          metadata: { reason },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      const dispatchers = await transaction.user.findMany({
        where: { role: UserRole.DISPATCHER, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      await this.notifications.createIdempotent(
        transaction,
        dispatchers.map((dispatcher) => ({
          userId: dispatcher.id,
          eventKey: `assignment:${current.id}:rejected`,
          type: 'PICKUP_ASSIGNMENT_REJECTED',
          title: 'Tài xế từ chối nhiệm vụ',
          message: `${current.shipment.trackingCode} cần được phân công lại.`,
          data: {
            shipmentId: current.shipmentId,
            assignmentId: current.id,
            reason,
          },
        })),
      );
      return transaction.driverAssignment.findUniqueOrThrow({
        where: { id: current.id },
        include: assignmentInclude,
      });
    });
    await this.notifications.publishByEventKeys([`assignment:${assignment.id}:rejected`]);
    await this.notifications.publishShipmentUpdated(
      assignment.shipmentId,
      ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
    );
    return toAssignmentResponse(assignment);
  }

  async pickup(
    actor: AuthenticatedUser,
    assignmentId: string,
    dto: PickupShipmentDto,
    context: ClientContext,
  ): Promise<AssignmentResponse> {
    try {
      const assignment = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.driverAssignment.findUnique({
          where: { id: assignmentId },
          include: assignmentInclude,
        });
        this.assertOwnership(current, actor.id);
        if (current.proof) {
          this.assertExistingProofOwnership(current, actor.id);
          await this.shippingFees.collectAt(transaction, {
            shipment: current.shipment,
            driver: current.driver,
            actor,
            amount: dto.shippingFeeAmount,
            point: 'PICKUP',
            collectedAt: current.proof.capturedAt,
            context,
          });
          return current;
        }
        if (current.status !== DriverAssignmentStatus.ACCEPTED) {
          throw this.assignmentStateConflict(current.status, 'complete pickup');
        }
        this.transitionPolicy.assertPickupable(current.shipment.status);
        const originWarehouseId =
          current.shipment.originWarehouseId ?? current.driver.operatingWarehouseId;
        if (!originWarehouseId) {
          throw new ConflictException({
            code: 'ORIGIN_WAREHOUSE_REQUIRED',
            message: 'Pickup driver must have an operating warehouse before completing pickup',
          });
        }
        if (
          current.shipment.originWarehouseId &&
          current.driver.operatingWarehouseId !== current.shipment.originWarehouseId
        ) {
          throw new ConflictException({
            code: 'ORIGIN_WAREHOUSE_MISMATCH',
            message:
              'Pickup driver operating warehouse does not match the shipment origin warehouse',
          });
        }
        const pickedUpAt = new Date();
        await this.shippingFees.collectAt(transaction, {
          shipment: current.shipment,
          driver: current.driver,
          actor,
          amount: dto.shippingFeeAmount,
          point: 'PICKUP',
          collectedAt: pickedUpAt,
          context,
        });
        await transaction.shipmentProof.create({
          data: {
            shipmentId: current.shipmentId,
            type: ShipmentProofType.PICKUP,
            driverAssignmentId: current.id,
            note: dto.note?.trim() || null,
            capturedAt: pickedUpAt,
            createdById: actor.id,
          },
        });
        const assignmentUpdate = await transaction.driverAssignment.updateMany({
          where: { id: current.id, status: DriverAssignmentStatus.ACCEPTED },
          data: { status: DriverAssignmentStatus.COMPLETED, completedAt: pickedUpAt },
        });
        this.assertUpdated(assignmentUpdate.count);
        const shipmentUpdate = await transaction.shipment.updateMany({
          where: {
            id: current.shipmentId,
            status: ShipmentStatus.PICKUP_IN_PROGRESS,
            version: current.shipment.version,
          },
          data: {
            status: ShipmentStatus.PICKED_UP,
            originWarehouseId,
            pickedUpAt,
            version: { increment: 1 },
          },
        });
        this.assertUpdated(shipmentUpdate.count);
        await this.updateDriverConditionally(
          transaction,
          current.driver,
          current.driver.isOnline
            ? { status: DriverStatus.AVAILABLE, isAvailable: true }
            : { status: DriverStatus.OFFLINE, isAvailable: false },
        );
        await transaction.trackingEvent.create({
          data: {
            shipmentId: current.shipmentId,
            status: ShipmentStatus.PICKED_UP,
            type: 'SHIPMENT_PICKED_UP',
            title: 'Đã lấy hàng',
            description: 'Tài xế đã xác nhận nhận kiện hàng.',
            visibility: TrackingVisibility.PUBLIC,
            actorId: actor.id,
            createdAt: pickedUpAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'SHIPMENT_PICKUP',
            entityType: 'Shipment',
            entityId: current.shipmentId,
            before: { status: current.shipment.status, version: current.shipment.version },
            after: {
              status: ShipmentStatus.PICKED_UP,
              version: current.shipment.version + 1,
              assignmentId: current.id,
              originWarehouseId,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        await this.notifications.createIdempotent(transaction, [
          {
            userId: current.shipment.customerId,
            eventKey: `shipment:${current.shipmentId}:picked-up`,
            type: 'SHIPMENT_PICKED_UP',
            title: 'Kiện hàng đã được lấy',
            message: `${current.shipment.trackingCode} đã được tài xế nhận.`,
            data: { shipmentId: current.shipmentId, assignmentId: current.id },
          },
        ]);
        return transaction.driverAssignment.findUniqueOrThrow({
          where: { id: current.id },
          include: assignmentInclude,
        });
      });
      await this.notifications.publishByEventKeys([`shipment:${assignment.shipmentId}:picked-up`]);
      await this.notifications.publishShipmentUpdated(
        assignment.shipmentId,
        ShipmentStatus.PICKED_UP,
      );
      return toAssignmentResponse(assignment);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.driverAssignment.findUnique({
          where: { id: assignmentId },
          include: assignmentInclude,
        });
        this.assertOwnership(existing, actor.id);
        if (existing.proof) {
          this.assertExistingProofOwnership(existing, actor.id);
          await this.notifications.publishByEventKeys([
            `shipment:${existing.shipmentId}:picked-up`,
          ]);
          return toAssignmentResponse(existing);
        }
      }
      throw error;
    }
  }

  private async assign(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: AssignPickupDriverDto | ReassignPickupDriverDto,
    context: ClientContext,
    isReassignment: boolean,
  ): Promise<AssignmentResponse> {
    try {
      const assignment = await this.prisma.$transaction(async (transaction) => {
        const idempotent = await transaction.driverAssignment.findUnique({
          where: {
            assignedById_clientRequestId: {
              assignedById: actor.id,
              clientRequestId: dto.clientRequestId,
            },
          },
          include: assignmentInclude,
        });
        if (idempotent) {
          if (idempotent.shipmentId !== shipmentId) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'The idempotency key was already used for another shipment',
            });
          }
          return idempotent;
        }
        const shipment = await transaction.shipment.findUnique({ where: { id: shipmentId } });
        if (!shipment) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
        if (isReassignment) {
          this.transitionPolicy.assertReassignable(shipment.status);
        } else {
          this.transitionPolicy.assertAssignable(shipment.status);
        }

        const previous = await transaction.driverAssignment.findFirst({
          where: {
            shipmentId,
            type: DriverAssignmentType.PICKUP,
            status: { in: activeAssignmentStatuses },
          },
          include: { driver: { include: { user: true } } },
        });
        if (isReassignment && !previous) {
          throw new ConflictException({
            code: 'ACTIVE_ASSIGNMENT_NOT_FOUND',
            message: 'There is no active pickup assignment to replace',
          });
        }
        if (!isReassignment && previous) {
          throw new ConflictException({
            code: 'ACTIVE_ASSIGNMENT_EXISTS',
            message: 'Shipment already has an active pickup assignment',
          });
        }
        if (previous?.driverId === dto.driverId) {
          throw new ConflictException({
            code: 'DRIVER_ALREADY_ASSIGNED',
            message: 'Choose a different driver for reassignment',
          });
        }
        const driver = await transaction.driverProfile.findUnique({
          where: { id: dto.driverId },
          include: { user: true, operatingWarehouse: true },
        });
        if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
        await this.driverOwnership.lock(transaction, driver.id);
        await this.driverOwnership.assertNoActiveLineHaulTrip(transaction, driver.id);
        await this.candidates.assertPickupEligible(driver, shipment);

        const now = new Date();
        if (previous) {
          const reason = (dto as ReassignPickupDriverDto).reason.trim();
          await transaction.driverAssignment.update({
            where: { id: previous.id },
            data: {
              status: DriverAssignmentStatus.CANCELLED,
              cancelledAt: now,
              reason,
            },
          });
          await this.updateDriverConditionally(
            transaction,
            previous.driver,
            previous.driver.user.status === UserStatus.ACTIVE &&
              previous.driver.status !== DriverStatus.SUSPENDED &&
              previous.driver.isOnline
              ? { status: DriverStatus.AVAILABLE, isAvailable: true }
              : { status: DriverStatus.OFFLINE, isOnline: false, isAvailable: false },
          );
        }

        const created = await transaction.driverAssignment.create({
          data: {
            shipmentId,
            driverId: driver.id,
            type: DriverAssignmentType.PICKUP,
            clientRequestId: dto.clientRequestId,
            assignedById: actor.id,
          },
        });
        await this.updateDriverConditionally(transaction, driver, {
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        });
        const shipmentUpdate = await transaction.shipment.updateMany({
          where: { id: shipment.id, status: shipment.status, version: shipment.version },
          data: { status: ShipmentStatus.PICKUP_ASSIGNED, version: { increment: 1 } },
        });
        this.assertUpdated(shipmentUpdate.count);
        await transaction.trackingEvent.create({
          data: {
            shipmentId,
            status: ShipmentStatus.PICKUP_ASSIGNED,
            type: isReassignment ? 'PICKUP_DRIVER_REASSIGNED' : 'PICKUP_DRIVER_ASSIGNED',
            title: isReassignment ? 'Đã phân công lại tài xế' : 'Đã phân công tài xế lấy hàng',
            description: 'Tài xế sẽ liên hệ để lấy kiện hàng.',
            visibility: TrackingVisibility.PUBLIC,
            actorId: actor.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: isReassignment ? 'PICKUP_DRIVER_REASSIGN' : 'PICKUP_DRIVER_ASSIGN',
            entityType: 'DriverAssignment',
            entityId: created.id,
            before: previous
              ? { assignmentId: previous.id, driverId: previous.driverId, status: previous.status }
              : Prisma.JsonNull,
            after: {
              assignmentId: created.id,
              driverId: driver.id,
              status: created.status,
              shipmentStatus: ShipmentStatus.PICKUP_ASSIGNED,
            },
            metadata: previous
              ? { reason: (dto as ReassignPickupDriverDto).reason.trim() }
              : undefined,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        await this.notifications.createIdempotent(transaction, [
          {
            userId: driver.userId,
            eventKey: `assignment:${created.id}:created`,
            type: 'PICKUP_ASSIGNMENT_CREATED',
            title: 'Nhiệm vụ lấy hàng mới',
            message: `Bạn được phân công lấy vận đơn ${shipment.trackingCode}.`,
            data: { shipmentId, assignmentId: created.id },
          },
          {
            userId: shipment.customerId,
            eventKey: `shipment:${shipment.id}:pickup-assigned:${created.id}`,
            type: 'PICKUP_DRIVER_ASSIGNED',
            title: 'Đã phân công tài xế lấy hàng',
            message: `${shipment.trackingCode} đã có tài xế phụ trách lấy hàng.`,
            data: { shipmentId, assignmentId: created.id },
          },
        ]);
        return transaction.driverAssignment.findUniqueOrThrow({
          where: { id: created.id },
          include: assignmentInclude,
        });
      });
      await this.notifications.publishByEventKeys([
        `assignment:${assignment.id}:created`,
        `shipment:${assignment.shipmentId}:pickup-assigned:${assignment.id}`,
      ]);
      this.notifications.publishAssignmentCreated({
        driverId: assignment.driverId,
        shipmentId: assignment.shipmentId,
        assignmentId: assignment.id,
      });
      return toAssignmentResponse(assignment);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.driverAssignment.findUnique({
          where: {
            assignedById_clientRequestId: {
              assignedById: actor.id,
              clientRequestId: dto.clientRequestId,
            },
          },
          include: assignmentInclude,
        });
        if (existing?.shipmentId === shipmentId) {
          await this.notifications.publishByEventKeys([
            `assignment:${existing.id}:created`,
            `shipment:${existing.shipmentId}:pickup-assigned:${existing.id}`,
          ]);
          return toAssignmentResponse(existing);
        }
        throw new ConflictException({
          code: 'ASSIGNMENT_CONCURRENT_CONFLICT',
          message: 'Shipment or driver was assigned concurrently; reload and try again',
        });
      }
      throw error;
    }
  }

  private toOperationalShipment(shipment: OperationalShipmentRecord) {
    const pickupAssignment = shipment.driverAssignments.find(
      (assignment) => assignment.type === DriverAssignmentType.PICKUP,
    );
    const deliveryAssignment = shipment.driverAssignments.find(
      (assignment) => assignment.type === DriverAssignmentType.DELIVERY,
    );
    const mapAssignment = (assignment: typeof pickupAssignment) =>
      assignment
        ? {
            id: assignment.id,
            status: assignment.status,
            driverId: assignment.driverId,
            driverName: assignment.driver.user.fullName,
            employeeCode: assignment.driver.employeeCode,
            assignedAt: assignment.assignedAt,
          }
        : null;
    const latestAttempt = shipment.deliveryAttempts[0];
    return {
      id: shipment.id,
      trackingCode: shipment.trackingCode,
      status: shipment.status,
      version: shipment.version,
      customer: shipment.customer,
      sender: shipment.senderSnapshot as unknown as ContactSnapshot,
      receiver: shipment.receiverSnapshot as unknown as ContactSnapshot,
      pickup: shipment.pickupSnapshot as unknown as AddressSnapshot,
      delivery: shipment.deliverySnapshot as unknown as AddressSnapshot,
      package: shipment.packageSnapshot as unknown as PackageSnapshot,
      totalFee: shipment.totalFee,
      codAmount: shipment.codAmount,
      shippingFeePayer: shipment.shippingFeePayer,
      shippingFee: toShippingFeeTransactionResponse(
        this.requireShippingFee(shipment.shippingFeeTransaction),
      ),
      originWarehouse: shipment.originWarehouse,
      destinationWarehouse: shipment.destinationWarehouse,
      currentWarehouse: shipment.currentWarehouse,
      returnWarehouse: shipment.returnWarehouse,
      createdAt: shipment.createdAt,
      confirmedAt: shipment.confirmedAt,
      assignment: mapAssignment(pickupAssignment),
      pickupAssignment: mapAssignment(pickupAssignment),
      deliveryAssignment: mapAssignment(deliveryAssignment),
      latestDeliveryAttempt: latestAttempt
        ? {
            id: latestAttempt.id,
            attemptNumber: latestAttempt.attemptNumber,
            status: latestAttempt.status,
            failureReason: latestAttempt.failureReason,
            failureNote: latestAttempt.failureNote,
            completedAt: latestAttempt.completedAt,
            proof: latestAttempt.proof
              ? {
                  id: latestAttempt.proof.id,
                  receiverName: latestAttempt.proof.receiverName,
                  note: latestAttempt.proof.note,
                  capturedAt: latestAttempt.proof.capturedAt,
                }
              : null,
          }
        : null,
    };
  }

  private assertOwnership(
    assignment: AssignmentWithDetails | null,
    userId: string,
  ): asserts assignment is AssignmentWithDetails {
    if (!assignment || assignment.driver.userId !== userId) {
      throw this.notFound('ASSIGNMENT_NOT_FOUND', 'Assignment was not found');
    }
  }

  private requireShippingFee(
    transaction: OperationalShipmentRecord['shippingFeeTransaction'],
  ): NonNullable<OperationalShipmentRecord['shippingFeeTransaction']> {
    if (!transaction) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_SNAPSHOT_INVALID',
        message: 'Shipping fee snapshot is missing for this shipment',
      });
    }
    return transaction;
  }

  private assertExistingProofOwnership(assignment: AssignmentWithDetails, userId: string): void {
    if (
      !assignment.proof ||
      assignment.proof.createdById !== userId ||
      assignment.proof.shipmentId !== assignment.shipmentId ||
      assignment.proof.driverAssignmentId !== assignment.id
    ) {
      throw new ForbiddenException({
        code: 'PROOF_OWNERSHIP_INVALID',
        message: 'Existing proof does not belong to this driver assignment',
      });
    }
  }

  private assertUpdated(count: number): void {
    if (count !== 1) {
      throw new ConflictException({
        code: 'SHIPMENT_CONCURRENT_MODIFICATION',
        message: 'Shipment changed concurrently; reload and try again',
      });
    }
  }

  private async updateDriverConditionally(
    transaction: Prisma.TransactionClient,
    driver: { id: string; version: number },
    data: Prisma.DriverProfileUpdateManyMutationInput,
  ): Promise<void> {
    const update = await transaction.driverProfile.updateMany({
      where: { id: driver.id, version: driver.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (update.count !== 1) {
      throw new ConflictException({
        code: 'DRIVER_CONCURRENT_MODIFICATION',
        message: 'Driver changed concurrently; reload and try again',
      });
    }
  }

  private assignmentStateConflict(status: DriverAssignmentStatus, command: string) {
    return new ConflictException({
      code: 'ASSIGNMENT_STATE_INVALID',
      message: `Cannot ${command} while assignment is ${status}`,
    });
  }

  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
