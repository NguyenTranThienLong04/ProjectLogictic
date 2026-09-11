import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CODTransactionStatus,
  DeliveryAttemptStatus,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentProofType,
  ShipmentStatus,
  TrackingVisibility,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { activeAssignmentStatuses } from './assignment.policy.js';
import { AssignmentCandidatesService } from './assignment-candidates.service.js';
import type { AssignDeliveryDriverDto } from './dto/assign-delivery-driver.dto.js';
import type { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import type { FailDeliveryDto } from './dto/fail-delivery.dto.js';
import type { ReturnNoteDto } from './dto/return-note.dto.js';
import {
  DriverDeliveryListView,
  ListDriverDeliveriesDto,
} from './dto/list-driver-deliveries.dto.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import { DriverTaskOwnershipService } from './driver-task-ownership.service.js';
import type { AddressSnapshot } from '../shipments/shipment.response.js';
import { toAddressTaskLocation, toWarehouseTaskLocation } from './task-location.response.js';
import { toShippingFeeTransactionResponse } from '../shipping-fees/shipping-fee.response.js';
import { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';

const deliveryAssignmentInclude = {
  shipment: { include: { destinationWarehouse: true, shippingFeeTransaction: true } },
  driver: { include: { user: true } },
  deliveryAttempts: { include: { proof: true }, orderBy: { attemptNumber: 'desc' }, take: 1 },
} satisfies Prisma.DriverAssignmentInclude;

type DeliveryAssignment = Prisma.DriverAssignmentGetPayload<{
  include: typeof deliveryAssignmentInclude;
}>;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitionPolicy: ShipmentTransitionPolicy,
    private readonly candidates: AssignmentCandidatesService,
    private readonly notifications: NotificationsService,
    private readonly driverOwnership: DriverTaskOwnershipService,
    private readonly shippingFees: ShippingFeesService,
  ) {}

  listCandidates(shipmentId: string) {
    return this.candidates.listDelivery(shipmentId);
  }

  async listMine(userId: string, query: ListDriverDeliveriesDto = new ListDriverDeliveriesDto()) {
    const driver = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const viewStatuses =
      query.view === DriverDeliveryListView.ACTIVE
        ? [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED]
        : query.view === DriverDeliveryListView.HISTORY
          ? [DriverAssignmentStatus.COMPLETED, DriverAssignmentStatus.CANCELLED]
          : undefined;
    const where: Prisma.DriverAssignmentWhereInput = {
      driverId: driver.id,
      type: DriverAssignmentType.DELIVERY,
      ...(query.status
        ? { status: query.status }
        : viewStatuses
          ? { status: { in: viewStatuses } }
          : {}),
      ...(query.attemptStatus
        ? { deliveryAttempts: { some: { status: query.attemptStatus } } }
        : {}),
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
      include: deliveryAssignmentInclude,
      orderBy: { assignedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.driverAssignment.count({ where });
    return {
      items: assignments.map((assignment) => this.response(assignment)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getMine(userId: string, assignmentId: string) {
    const assignment = await this.prisma.driverAssignment.findFirst({
      where: {
        id: assignmentId,
        type: DriverAssignmentType.DELIVERY,
        driver: { userId },
      },
      include: deliveryAssignmentInclude,
    });
    if (!assignment) throw this.notFound('ASSIGNMENT_NOT_FOUND', 'Assignment was not found');
    return this.response(assignment);
  }

  async assign(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: AssignDeliveryDriverDto,
    context: ClientContext,
  ) {
    let assignment: DeliveryAssignment;
    try {
      assignment = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.driverAssignment.findUnique({
          where: {
            assignedById_clientRequestId: {
              assignedById: actor.id,
              clientRequestId: dto.clientRequestId,
            },
          },
          include: deliveryAssignmentInclude,
        });
        if (existing) {
          if (
            existing.shipmentId !== shipmentId ||
            existing.type !== DriverAssignmentType.DELIVERY
          ) {
            throw this.conflict('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used');
          }
          return existing;
        }
        const shipment = await tx.shipment.findUnique({
          where: { id: shipmentId },
          include: { destinationWarehouse: true },
        });
        if (!shipment) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
        this.transitionPolicy.assertDeliveryAssignable(shipment.status);
        const driver = await tx.driverProfile.findUnique({
          where: { id: dto.driverId },
          include: { user: true, operatingWarehouse: true },
        });
        if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
        await this.driverOwnership.lock(tx, driver.id);
        await this.driverOwnership.assertNoActiveLineHaulTrip(tx, driver.id);
        await this.candidates.assertDeliveryEligible(driver, shipment);
        const created = await tx.driverAssignment.create({
          data: {
            shipmentId,
            driverId: driver.id,
            type: DriverAssignmentType.DELIVERY,
            clientRequestId: dto.clientRequestId,
            assignedById: actor.id,
          },
        });
        await this.updateDriverConditionally(tx, driver, {
          status: DriverStatus.BUSY,
          isAvailable: false,
        });
        await this.updateShipment(tx, shipment, ShipmentStatus.DELIVERY_ASSIGNED);
        await this.trackAudit(
          tx,
          shipment,
          actor,
          context,
          ShipmentStatus.DELIVERY_ASSIGNED,
          'DELIVERY_DRIVER_ASSIGNED',
          'Đã phân công tài xế giao hàng',
          'DELIVERY_DRIVER_ASSIGN',
          created.id,
        );
        await this.notifications.createIdempotent(tx, [
          {
            userId: driver.userId,
            eventKey: `assignment:${created.id}:created`,
            type: 'DELIVERY_ASSIGNMENT_CREATED',
            title: 'Nhiệm vụ giao hàng mới',
            message: `Bạn được phân công giao vận đơn ${shipment.trackingCode}.`,
            data: { shipmentId, assignmentId: created.id },
          },
          {
            userId: shipment.customerId,
            eventKey: `shipment:${shipmentId}:delivery-assigned:${created.id}`,
            type: 'DELIVERY_DRIVER_ASSIGNED',
            title: 'Đã phân công tài xế giao hàng',
            message: `${shipment.trackingCode} đã có tài xế giao hàng.`,
            data: { shipmentId, assignmentId: created.id },
          },
        ]);
        return tx.driverAssignment.findUniqueOrThrow({
          where: { id: created.id },
          include: deliveryAssignmentInclude,
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.driverAssignment.findUnique({
        where: {
          assignedById_clientRequestId: {
            assignedById: actor.id,
            clientRequestId: dto.clientRequestId,
          },
        },
        include: deliveryAssignmentInclude,
      });
      if (
        !existing ||
        existing.shipmentId !== shipmentId ||
        existing.type !== DriverAssignmentType.DELIVERY
      ) {
        throw this.conflict(
          'DELIVERY_ASSIGNMENT_CONFLICT',
          'Assignment changed concurrently; reload and try again',
        );
      }
      assignment = existing;
    }
    await this.notifications.publishByEventKeys([
      `assignment:${assignment.id}:created`,
      `shipment:${shipmentId}:delivery-assigned:${assignment.id}`,
    ]);
    this.notifications.publishAssignmentCreated({
      driverId: assignment.driverId,
      shipmentId,
      assignmentId: assignment.id,
    });
    return this.response(assignment);
  }

  async start(actor: AuthenticatedUser, assignmentId: string, context: ClientContext) {
    let assignment: DeliveryAssignment;
    try {
      assignment = await this.prisma.$transaction(async (tx) => {
        const current = await tx.driverAssignment.findUnique({
          where: { id: assignmentId },
          include: deliveryAssignmentInclude,
        });
        this.assertOwnedDelivery(current, actor.id);
        if (
          current.status === DriverAssignmentStatus.ACCEPTED &&
          current.shipment.status === ShipmentStatus.OUT_FOR_DELIVERY
        )
          return current;
        if (current.status !== DriverAssignmentStatus.PENDING)
          throw this.conflict('ASSIGNMENT_STATE_INVALID', 'Delivery assignment cannot be started');
        this.transitionPolicy.assertDeliveryStartable(current.shipment.status);
        const now = new Date();
        await tx.driverAssignment.update({
          where: { id: current.id },
          data: { status: DriverAssignmentStatus.ACCEPTED, acceptedAt: now },
        });
        const previousAttempts = await tx.deliveryAttempt.count({
          where: { shipmentId: current.shipmentId },
        });
        await tx.deliveryAttempt.create({
          data: {
            shipmentId: current.shipmentId,
            driverId: current.driverId,
            driverAssignmentId: current.id,
            attemptNumber: previousAttempts + 1,
            startedAt: now,
          },
        });
        await this.updateShipment(tx, current.shipment, ShipmentStatus.OUT_FOR_DELIVERY);
        await this.trackAudit(
          tx,
          current.shipment,
          actor,
          context,
          ShipmentStatus.OUT_FOR_DELIVERY,
          'OUT_FOR_DELIVERY',
          'Đang giao hàng',
          'DELIVERY_START',
          current.id,
        );
        await this.notifications.createIdempotent(tx, [
          {
            userId: current.shipment.customerId,
            eventKey: `shipment:${current.shipmentId}:out-for-delivery:${current.id}`,
            type: 'OUT_FOR_DELIVERY',
            title: 'Đang giao hàng',
            message: `${current.shipment.trackingCode} đang được giao đến bạn.`,
            data: { shipmentId: current.shipmentId, assignmentId: current.id },
          },
        ]);
        return tx.driverAssignment.findUniqueOrThrow({
          where: { id: current.id },
          include: deliveryAssignmentInclude,
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: deliveryAssignmentInclude,
      });
      this.assertOwnedDelivery(existing, actor.id);
      if (
        existing.status !== DriverAssignmentStatus.ACCEPTED ||
        existing.shipment.status !== ShipmentStatus.OUT_FOR_DELIVERY ||
        !existing.deliveryAttempts[0]
      ) {
        throw this.conflict(
          'DELIVERY_START_CONFLICT',
          'Delivery start changed concurrently; reload and try again',
        );
      }
      assignment = existing;
    }
    await this.notifications.publishByEventKeys([
      `shipment:${assignment.shipmentId}:out-for-delivery:${assignment.id}`,
    ]);
    await this.notifications.publishShipmentUpdated(
      assignment.shipmentId,
      ShipmentStatus.OUT_FOR_DELIVERY,
    );
    return this.response(assignment);
  }

  async complete(
    actor: AuthenticatedUser,
    assignmentId: string,
    dto: CompleteDeliveryDto,
    context: ClientContext,
  ) {
    let assignment: DeliveryAssignment;
    try {
      assignment = await this.prisma.$transaction(async (tx) => {
        const current = await tx.driverAssignment.findUnique({
          where: { id: assignmentId },
          include: deliveryAssignmentInclude,
        });
        this.assertOwnedDelivery(current, actor.id);
        const attempt = current.deliveryAttempts[0];
        if (attempt?.proof) {
          await this.shippingFees.collectAt(tx, {
            shipment: current.shipment,
            driver: current.driver,
            actor,
            amount: dto.shippingFeeAmount,
            point: 'DELIVERY',
            collectedAt: attempt.completedAt ?? attempt.proof.capturedAt,
            context,
          });
          return current;
        }
        if (!attempt || current.status !== DriverAssignmentStatus.ACCEPTED)
          throw this.conflict('DELIVERY_ATTEMPT_INVALID', 'No active delivery attempt exists');
        this.transitionPolicy.assertDeliverable(current.shipment.status);
        const completedAt = new Date();
        await this.shippingFees.collectAt(tx, {
          shipment: current.shipment,
          driver: current.driver,
          actor,
          amount: dto.shippingFeeAmount,
          point: 'DELIVERY',
          collectedAt: completedAt,
          context,
        });
        await tx.shipmentProof.create({
          data: {
            shipmentId: current.shipmentId,
            type: ShipmentProofType.DELIVERY,
            deliveryAttemptId: attempt.id,
            receiverName: dto.receiverName.trim(),
            note: dto.note?.trim() || null,
            capturedAt: completedAt,
            createdById: actor.id,
          },
        });
        await tx.deliveryAttempt.update({
          where: { id: attempt.id },
          data: { status: DeliveryAttemptStatus.DELIVERED, completedAt },
        });
        await tx.driverAssignment.update({
          where: { id: current.id },
          data: { status: DriverAssignmentStatus.COMPLETED, completedAt },
        });
        await this.updateDriverConditionally(
          tx,
          current.driver,
          current.driver.isOnline
            ? { status: DriverStatus.AVAILABLE, isAvailable: true }
            : { status: DriverStatus.OFFLINE, isAvailable: false },
        );
        await this.updateShipment(tx, current.shipment, ShipmentStatus.DELIVERED);
        if (current.shipment.codAmount > 0) {
          await tx.cODTransaction.create({
            data: {
              shipmentId: current.shipmentId,
              expectedAmount: current.shipment.codAmount,
              collectedAmount: current.shipment.codAmount,
              collectedByDriverId: current.driverId,
              collectedAt: completedAt,
              status: CODTransactionStatus.COLLECTED,
            },
          });
        }
        await this.trackAudit(
          tx,
          current.shipment,
          actor,
          context,
          ShipmentStatus.DELIVERED,
          'DELIVERED',
          'Đã giao hàng thành công',
          'DELIVERY_COMPLETE',
          attempt.id,
        );
        await this.notifications.createIdempotent(tx, [
          {
            userId: current.shipment.customerId,
            eventKey: `shipment:${current.shipmentId}:delivered`,
            type: 'DELIVERED',
            title: 'Đã giao hàng',
            message: `${current.shipment.trackingCode} đã được giao thành công.`,
            data: { shipmentId: current.shipmentId, attemptId: attempt.id },
          },
        ]);
        return tx.driverAssignment.findUniqueOrThrow({
          where: { id: current.id },
          include: deliveryAssignmentInclude,
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: deliveryAssignmentInclude,
      });
      this.assertOwnedDelivery(existing, actor.id);
      if (!existing.deliveryAttempts[0]?.proof) {
        throw this.conflict(
          'DELIVERY_COMPLETE_CONFLICT',
          'Delivery completion changed concurrently; reload and try again',
        );
      }
      assignment = existing;
    }
    await this.notifications.publishByEventKeys([`shipment:${assignment.shipmentId}:delivered`]);
    await this.notifications.publishShipmentUpdated(
      assignment.shipmentId,
      ShipmentStatus.DELIVERED,
    );
    return this.response(assignment);
  }

  async fail(
    actor: AuthenticatedUser,
    assignmentId: string,
    dto: FailDeliveryDto,
    context: ClientContext,
  ) {
    const assignment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: deliveryAssignmentInclude,
      });
      this.assertOwnedDelivery(current, actor.id);
      const attempt = current.deliveryAttempts[0];
      if (
        attempt?.status === DeliveryAttemptStatus.FAILED &&
        current.shipment.status === ShipmentStatus.DELIVERY_FAILED
      )
        return current;
      if (!attempt || current.status !== DriverAssignmentStatus.ACCEPTED)
        throw this.conflict('DELIVERY_ATTEMPT_INVALID', 'No active delivery attempt exists');
      this.transitionPolicy.assertDeliveryFailing(current.shipment.status);
      const completedAt = new Date();
      await tx.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: DeliveryAttemptStatus.FAILED,
          failureReason: dto.reason,
          failureNote: dto.note?.trim() || null,
          completedAt,
        },
      });
      await tx.driverAssignment.update({
        where: { id: current.id },
        data: { status: DriverAssignmentStatus.COMPLETED, completedAt, reason: dto.reason },
      });
      await this.updateDriverConditionally(
        tx,
        current.driver,
        current.driver.isOnline
          ? { status: DriverStatus.AVAILABLE, isAvailable: true }
          : { status: DriverStatus.OFFLINE, isAvailable: false },
      );
      await this.updateShipment(tx, current.shipment, ShipmentStatus.DELIVERY_FAILED);
      await this.trackAudit(
        tx,
        current.shipment,
        actor,
        context,
        ShipmentStatus.DELIVERY_FAILED,
        'DELIVERY_FAILED',
        'Giao hàng chưa thành công',
        'DELIVERY_FAIL',
        attempt.id,
        dto.reason,
      );
      await this.notifications.createIdempotent(tx, [
        {
          userId: current.shipment.customerId,
          eventKey: `shipment:${current.shipmentId}:delivery-failed:${attempt.id}`,
          type: 'DELIVERY_FAILED',
          title: 'Giao hàng chưa thành công',
          message: `${current.shipment.trackingCode} cần được điều phối lại.`,
          data: { shipmentId: current.shipmentId, attemptId: attempt.id, reason: dto.reason },
        },
      ]);
      return tx.driverAssignment.findUniqueOrThrow({
        where: { id: current.id },
        include: deliveryAssignmentInclude,
      });
    });
    await this.notifications.publishByEventKeys([
      `shipment:${assignment.shipmentId}:delivery-failed:${assignment.deliveryAttempts[0]?.id}`,
    ]);
    await this.notifications.publishShipmentUpdated(
      assignment.shipmentId,
      ShipmentStatus.DELIVERY_FAILED,
    );
    return this.response(assignment);
  }

  async redeliver(actor: AuthenticatedUser, shipmentId: string, context: ClientContext) {
    return this.dispatcherTransition(
      actor,
      shipmentId,
      context,
      ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
      'DELIVERY_REDELIVERY_SCHEDULE',
      'Đang chờ phân công giao lại',
      'REDLIVERY_SCHEDULE',
    );
  }

  async requestReturn(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: ReturnNoteDto,
    context: ClientContext,
  ) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shipment.findUnique({ where: { id: shipmentId } });
      if (!current) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
      if (current.status === ShipmentStatus.RETURN_REQUESTED) return current;
      this.transitionPolicy.assertReturnRequestable(current.status);
      const returnWarehouseId = dto.returnWarehouseId ?? current.originWarehouseId;
      if (!returnWarehouseId)
        throw this.conflict('RETURN_WAREHOUSE_REQUIRED', 'A return warehouse is required');
      const warehouse = await tx.warehouse.findUnique({ where: { id: returnWarehouseId } });
      if (!warehouse?.isActive)
        throw this.notFound(
          'RETURN_WAREHOUSE_NOT_FOUND',
          'Return warehouse was not found or inactive',
        );
      const result = await tx.shipment.updateMany({
        where: { id: current.id, status: current.status, version: current.version },
        data: {
          status: ShipmentStatus.RETURN_REQUESTED,
          returnWarehouseId,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw this.conflict(
          'SHIPMENT_CONCURRENT_MODIFICATION',
          'Shipment changed concurrently; reload and try again',
        );
      await this.trackAudit(
        tx,
        current,
        actor,
        context,
        ShipmentStatus.RETURN_REQUESTED,
        'RETURN_REQUESTED',
        'Đã yêu cầu hoàn hàng',
        'RETURN_REQUEST',
        current.id,
        dto.note,
      );
      return tx.shipment.findUniqueOrThrow({ where: { id: current.id } });
    });
    await this.notifications.publishShipmentUpdated(shipmentId, ShipmentStatus.RETURN_REQUESTED);
    return shipment;
  }

  async startReturn(actor: AuthenticatedUser, shipmentId: string, context: ClientContext) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          deliveryAttempts: {
            orderBy: { attemptNumber: 'desc' },
            take: 1,
            include: { driver: { include: { user: true } } },
          },
        },
      });
      if (!current) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
      if (current.status === ShipmentStatus.RETURN_IN_TRANSIT) return current;
      this.transitionPolicy.assertReturnStartable(current.status);
      const attempt = current.deliveryAttempts[0];
      if (
        !attempt ||
        attempt.status !== DeliveryAttemptStatus.FAILED ||
        attempt.driver.userId !== actor.id ||
        attempt.driver.user.status !== 'ACTIVE' ||
        attempt.driver.status === DriverStatus.SUSPENDED
      )
        throw this.notFound(
          'RETURN_ATTEMPT_NOT_FOUND',
          'No failed delivery attempt owned by this driver was found',
        );
      const supersedingAssignment = await tx.driverAssignment.findFirst({
        where: {
          shipmentId: current.id,
          type: { in: [DriverAssignmentType.PICKUP, DriverAssignmentType.DELIVERY] },
          status: { in: activeAssignmentStatuses },
          assignedAt: { gt: attempt.completedAt! },
        },
      });
      if (supersedingAssignment)
        throw this.conflict(
          'RETURN_OWNERSHIP_SUPERSEDED',
          'A newer active assignment owns this shipment',
        );
      const result = await tx.shipment.updateMany({
        where: {
          id: current.id,
          status: ShipmentStatus.RETURN_REQUESTED,
          version: current.version,
        },
        data: {
          status: ShipmentStatus.RETURN_IN_TRANSIT,
          currentWarehouseId: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw this.conflict(
          'SHIPMENT_CONCURRENT_MODIFICATION',
          'Shipment changed concurrently; reload and try again',
        );
      await this.trackAudit(
        tx,
        current,
        actor,
        context,
        ShipmentStatus.RETURN_IN_TRANSIT,
        'RETURN_IN_TRANSIT',
        'Đang hoàn hàng',
        'RETURN_START',
        attempt.id,
      );
      await this.notifications.createIdempotent(tx, [
        {
          userId: current.customerId,
          eventKey: `shipment:${current.id}:return-started`,
          type: 'RETURN_STARTED',
          title: 'Đang hoàn hàng',
          message: `${current.trackingCode} đang được chuyển về kho hoàn hàng.`,
          data: { shipmentId: current.id },
        },
      ]);
      return tx.shipment.findUniqueOrThrow({ where: { id: current.id } });
    });
    await this.notifications.publishByEventKeys([`shipment:${shipmentId}:return-started`]);
    await this.notifications.publishShipmentUpdated(shipmentId, ShipmentStatus.RETURN_IN_TRANSIT);
    return shipment;
  }

  private async dispatcherTransition(
    actor: AuthenticatedUser,
    shipmentId: string,
    context: ClientContext,
    next: ShipmentStatus,
    type: string,
    title: string,
    action: string,
    note?: string,
  ) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shipment.findUnique({ where: { id: shipmentId } });
      if (!current) throw this.notFound('SHIPMENT_NOT_FOUND', 'Shipment was not found');
      if (current.status === next) return current;
      if (next === ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT)
        this.transitionPolicy.assertRedeliverable(current.status);
      if (next === ShipmentStatus.RETURN_REQUESTED)
        this.transitionPolicy.assertReturnRequestable(current.status);
      await this.updateShipment(tx, current, next);
      await this.trackAudit(
        tx,
        current,
        actor,
        context,
        next,
        type,
        title,
        action,
        current.id,
        note,
      );
      return tx.shipment.findUniqueOrThrow({ where: { id: current.id } });
    });
    await this.notifications.publishShipmentUpdated(shipmentId, next);
    return shipment;
  }

  private async updateShipment(
    tx: Prisma.TransactionClient,
    current: { id: string; status: ShipmentStatus; version: number },
    status: ShipmentStatus,
  ) {
    const result = await tx.shipment.updateMany({
      where: { id: current.id, status: current.status, version: current.version },
      data: { status, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw this.conflict(
        'SHIPMENT_CONCURRENT_MODIFICATION',
        'Shipment changed concurrently; reload and try again',
      );
  }

  private async updateDriverConditionally(
    tx: Prisma.TransactionClient,
    driver: { id: string; version: number },
    data: Prisma.DriverProfileUpdateManyMutationInput,
  ): Promise<void> {
    const result = await tx.driverProfile.updateMany({
      where: { id: driver.id, version: driver.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw this.conflict(
        'DRIVER_CONCURRENT_MODIFICATION',
        'Driver changed concurrently; reload and try again',
      );
  }

  private async trackAudit(
    tx: Prisma.TransactionClient,
    shipment: { id: string; status: ShipmentStatus; version: number },
    actor: AuthenticatedUser,
    context: ClientContext,
    status: ShipmentStatus,
    type: string,
    title: string,
    action: string,
    entityId: string,
    note?: string,
  ) {
    await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status,
        type,
        title,
        description: note || null,
        visibility: TrackingVisibility.PUBLIC,
        actorId: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action,
        entityType: 'Shipment',
        entityId,
        before: { status: shipment.status, version: shipment.version },
        after: { status, version: shipment.version + 1 },
        ...(note ? { metadata: { note } } : {}),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  private assertOwnedDelivery(
    assignment: DeliveryAssignment | null,
    userId: string,
  ): asserts assignment is DeliveryAssignment {
    if (
      !assignment ||
      assignment.type !== DriverAssignmentType.DELIVERY ||
      assignment.driver.userId !== userId
    )
      throw this.notFound('ASSIGNMENT_NOT_FOUND', 'Assignment was not found');
  }

  private response(assignment: DeliveryAssignment) {
    const attempt = assignment.deliveryAttempts[0] ?? null;
    const shippingFee = assignment.shipment.shippingFeeTransaction;
    if (!shippingFee) throw new Error('Shipping fee snapshot is missing for this shipment');
    const delivery = assignment.shipment.deliverySnapshot as unknown as AddressSnapshot;
    const taskLocation = attempt
      ? toAddressTaskLocation(
          'RECEIVER',
          delivery.contactName ? `Điểm giao · ${delivery.contactName}` : 'Điểm giao',
          delivery,
        )
      : assignment.shipment.destinationWarehouse
        ? toWarehouseTaskLocation(assignment.shipment.destinationWarehouse)
        : null;
    return {
      id: assignment.id,
      shipmentId: assignment.shipmentId,
      trackingCode: assignment.shipment.trackingCode,
      type: assignment.type,
      status: assignment.status,
      assignedAt: assignment.assignedAt,
      acceptedAt: assignment.acceptedAt,
      completedAt: assignment.completedAt,
      shipmentStatus: assignment.shipment.status,
      receiver: assignment.shipment.receiverSnapshot,
      delivery: {
        contactName: delivery.contactName,
        phone: delivery.phone,
        streetAddress: delivery.streetAddress,
        ward: delivery.ward,
        district: delivery.district,
        city: delivery.city,
      },
      taskLocation,
      codAmount: assignment.shipment.codAmount,
      shippingFee: toShippingFeeTransactionResponse(shippingFee),
      availableActions: {
        collectShippingFee:
          shippingFee.payer === ShippingFeePayer.RECEIVER &&
          shippingFee.status === ShippingFeeTransactionStatus.PENDING &&
          assignment.status === DriverAssignmentStatus.ACCEPTED &&
          assignment.shipment.status === ShipmentStatus.OUT_FOR_DELIVERY &&
          attempt?.status === DeliveryAttemptStatus.OUT_FOR_DELIVERY,
      },
      driver: {
        id: assignment.driver.id,
        fullName: assignment.driver.user.fullName,
        employeeCode: assignment.driver.employeeCode,
      },
      attempt: attempt
        ? {
            id: attempt.id,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            failureReason: attempt.failureReason,
            failureNote: attempt.failureNote,
            proof: attempt.proof,
          }
        : null,
    };
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
  private notFound(code: string, message: string) {
    return new NotFoundException({ code, message });
  }
}
