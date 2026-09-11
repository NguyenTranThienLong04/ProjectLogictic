import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LineHaulTripStatus,
  Prisma,
  ShipmentStatus,
  TrackingVisibility,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { ShipmentTransitionPolicy } from '../assignments/shipment-transition.policy.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ReceiveTransferDto } from './dto/receive-transfer.dto.js';
import {
  warehouseTransferResponseInclude,
  type WarehouseTransferResponseEntity,
} from './warehouse.response.js';

interface DispatchTransferInput {
  warehouseId: string;
  transferId: string;
  actor: AuthenticatedUser;
  context: ClientContext;
  lineHaulTripId?: string;
}

interface ReceiveTransferInput {
  warehouseId: string;
  transferId: string;
  dto: ReceiveTransferDto;
  actor: AuthenticatedUser;
  context: ClientContext;
}

export interface WarehouseTransferTransitionResult {
  transfer: WarehouseTransferResponseEntity;
  transitioned: boolean;
}

@Injectable()
export class WarehouseTransferLifecycleService {
  constructor(
    private readonly transitionPolicy: ShipmentTransitionPolicy,
    private readonly notifications: NotificationsService,
  ) {}

  assertDispatchableTransfer(
    transfer: {
      status: WarehouseTransferStatus;
      fromWarehouseId: string;
      toWarehouseId: string;
      shipment: {
        status: ShipmentStatus;
        currentWarehouseId: string | null;
        destinationWarehouseId: string | null;
      };
    },
    route: { originWarehouseId: string; destinationWarehouseId: string },
  ): void {
    if (
      transfer.fromWarehouseId !== route.originWarehouseId ||
      transfer.toWarehouseId !== route.destinationWarehouseId
    ) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRANSFER_ROUTE_MISMATCH',
        message: 'Warehouse transfer route must match the line-haul trip route',
      });
    }
    if (transfer.status !== WarehouseTransferStatus.PENDING) {
      throw new ConflictException({
        code: 'WAREHOUSE_TRANSFER_NOT_PENDING',
        message: 'Every transfer on a ready manifest must still be pending',
      });
    }
    if (transfer.shipment.currentWarehouseId !== route.originWarehouseId) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_AT_ORIGIN_WAREHOUSE',
        message: 'Every shipment on the manifest must be at the trip origin warehouse',
      });
    }
    if (transfer.shipment.destinationWarehouseId !== route.destinationWarehouseId) {
      throw new ConflictException({
        code: 'TRANSFER_DESTINATION_MISMATCH',
        message: 'Transfer destination must match the shipment sorting destination',
      });
    }
    this.transitionPolicy.assertTransferDispatch(transfer.shipment.status);
  }

  async dispatch(
    transaction: Prisma.TransactionClient,
    input: DispatchTransferInput,
  ): Promise<WarehouseTransferTransitionResult> {
    await this.lockTransfer(transaction, input.transferId);
    const transfer = await transaction.warehouseTransfer.findUnique({
      where: { id: input.transferId },
      include: warehouseTransferResponseInclude,
    });
    if (!transfer) this.notFound();
    if (transfer.fromWarehouseId !== input.warehouseId) {
      throw new ForbiddenException({
        code: 'TRANSFER_ORIGIN_MISMATCH',
        message: 'Only the origin warehouse can dispatch this transfer',
      });
    }
    if (
      (transfer.status === WarehouseTransferStatus.IN_TRANSIT ||
        transfer.status === WarehouseTransferStatus.COMPLETED) &&
      transfer.dispatchedAt
    ) {
      return { transfer, transitioned: false };
    }

    const activeAssignment = await transaction.lineHaulTripTransfer.findFirst({
      where: { warehouseTransferId: transfer.id, isActive: true },
      include: { trip: true },
    });
    if (input.lineHaulTripId) {
      if (
        activeAssignment?.tripId !== input.lineHaulTripId ||
        activeAssignment.trip.status !== LineHaulTripStatus.IN_TRANSIT
      ) {
        throw new ConflictException({
          code: 'LINE_HAUL_MANIFEST_OWNERSHIP_INVALID',
          message: 'Transfer is not on the dispatched trip manifest',
        });
      }
    } else if (activeAssignment) {
      throw new ConflictException({
        code: 'WAREHOUSE_TRANSFER_ASSIGNED_TO_TRIP',
        message: 'Dispatch the owning line-haul trip instead of dispatching this transfer alone',
      });
    }

    if (!transfer.fromWarehouse.isActive || !transfer.toWarehouse.isActive) {
      throw new ConflictException({
        code: 'LINE_HAUL_WAREHOUSE_INACTIVE',
        message: 'Origin and destination warehouses must remain active for dispatch',
      });
    }
    this.assertDispatchableTransfer(transfer, {
      originWarehouseId: input.warehouseId,
      destinationWarehouseId: transfer.toWarehouseId,
    });

    const dispatchedAt = new Date();
    const transferUpdate = await transaction.warehouseTransfer.updateMany({
      where: { id: transfer.id, status: WarehouseTransferStatus.PENDING },
      data: {
        status: WarehouseTransferStatus.IN_TRANSIT,
        dispatchedById: input.actor.id,
        dispatchedAt,
      },
    });
    this.assertUpdated(transferUpdate.count, 'Transfer');
    const shipmentUpdate = await transaction.shipment.updateMany({
      where: {
        id: transfer.shipment.id,
        status: transfer.shipment.status,
        version: transfer.shipment.version,
        currentWarehouseId: input.warehouseId,
        destinationWarehouseId: transfer.toWarehouseId,
      },
      data: {
        status: ShipmentStatus.IN_TRANSIT,
        currentWarehouseId: null,
        version: { increment: 1 },
      },
    });
    this.assertUpdated(shipmentUpdate.count, 'Shipment');

    await transaction.trackingEvent.create({
      data: {
        shipmentId: transfer.shipmentId,
        status: ShipmentStatus.IN_TRANSIT,
        type: 'WAREHOUSE_TRANSFER_DISPATCHED',
        title: 'Đang trung chuyển liên kho',
        description: `Kiện hàng đang được chuyển từ ${transfer.fromWarehouse.name} đến ${transfer.toWarehouse.name}.${
          transfer.note ? ` Ghi chú: ${transfer.note}` : ''
        }`,
        visibility: TrackingVisibility.PUBLIC,
        actorId: input.actor.id,
        warehouseId: input.warehouseId,
        createdAt: dispatchedAt,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'WAREHOUSE_TRANSFER_DISPATCHED',
        entityType: 'WAREHOUSE_TRANSFER',
        entityId: transfer.id,
        before: { status: WarehouseTransferStatus.PENDING },
        after: {
          status: WarehouseTransferStatus.IN_TRANSIT,
          shipmentStatus: ShipmentStatus.IN_TRANSIT,
          currentWarehouseId: null,
        },
        metadata: input.lineHaulTripId ? { lineHaulTripId: input.lineHaulTripId } : undefined,
        ipAddress: input.context.ipAddress ?? null,
        userAgent: input.context.userAgent ?? null,
      },
    });
    return {
      transfer: await transaction.warehouseTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: warehouseTransferResponseInclude,
      }),
      transitioned: true,
    };
  }

  async receive(
    transaction: Prisma.TransactionClient,
    input: ReceiveTransferInput,
  ): Promise<WarehouseTransferTransitionResult> {
    await this.lockTransfer(transaction, input.transferId);
    const transfer = await transaction.warehouseTransfer.findUnique({
      where: { id: input.transferId },
      include: warehouseTransferResponseInclude,
    });
    if (!transfer) this.notFound();
    if (transfer.toWarehouseId !== input.warehouseId) {
      throw new ForbiddenException({
        code: 'TRANSFER_DESTINATION_MISMATCH',
        message: 'Cannot receive transfer addressed to another warehouse',
      });
    }
    if (transfer.status === WarehouseTransferStatus.COMPLETED) {
      return { transfer, transitioned: false };
    }
    if (!transfer.toWarehouse.isActive) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found or inactive',
      });
    }
    if (transfer.status !== WarehouseTransferStatus.IN_TRANSIT) {
      throw new ConflictException({
        code: 'INVALID_TRANSFER_STATUS',
        message: `Transfer status is ${transfer.status}, expected IN_TRANSIT`,
      });
    }

    const activeAssignment = await transaction.lineHaulTripTransfer.findFirst({
      where: { warehouseTransferId: transfer.id, isActive: true },
      include: { trip: { select: { id: true, status: true } } },
    });
    if (activeAssignment && activeAssignment.trip.status !== LineHaulTripStatus.ARRIVED) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_ARRIVED',
        message: 'Confirm arrival of the line-haul trip before receiving its transfers',
      });
    }
    this.transitionPolicy.assertTransferReceive(transfer.shipment.status);

    const receivedAt = new Date();
    const transferUpdate = await transaction.warehouseTransfer.updateMany({
      where: { id: transfer.id, status: WarehouseTransferStatus.IN_TRANSIT },
      data: {
        status: WarehouseTransferStatus.COMPLETED,
        receivedById: input.actor.id,
        receivedAt,
      },
    });
    this.assertUpdated(transferUpdate.count, 'Transfer');
    const shipmentUpdate = await transaction.shipment.updateMany({
      where: {
        id: transfer.shipment.id,
        status: transfer.shipment.status,
        version: transfer.shipment.version,
      },
      data: {
        currentWarehouseId: input.warehouseId,
        status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
        version: { increment: 1 },
      },
    });
    this.assertUpdated(shipmentUpdate.count, 'Shipment');
    await transaction.trackingEvent.create({
      data: {
        shipmentId: transfer.shipmentId,
        status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
        type: 'WAREHOUSE_TRANSFER_RECEIVED',
        title: 'Đã nhập kho đích',
        description: `Kiện hàng đã đến kho ${transfer.toWarehouse.name} (${transfer.toWarehouse.code}).${
          input.dto.note ? ` Ghi chú: ${input.dto.note}` : ''
        }`,
        visibility: TrackingVisibility.PUBLIC,
        actorId: input.actor.id,
        warehouseId: input.warehouseId,
        createdAt: receivedAt,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'WAREHOUSE_TRANSFER_RECEIVED',
        entityType: 'WAREHOUSE_TRANSFER',
        entityId: transfer.id,
        before: { status: transfer.status },
        after: {
          status: WarehouseTransferStatus.COMPLETED,
          receivedById: input.actor.id,
          warehouseId: input.warehouseId,
          actualWeightGrams: input.dto.actualWeightGrams,
          note: input.dto.note?.trim() || null,
        },
        metadata: activeAssignment ? { lineHaulTripId: activeAssignment.tripId } : undefined,
        ipAddress: input.context.ipAddress ?? null,
        userAgent: input.context.userAgent ?? null,
      },
    });
    await this.notifications.createIdempotent(transaction, [
      {
        userId: transfer.shipment.customerId,
        eventKey: `shipment:${transfer.shipmentId}:warehouse-destination:${input.warehouseId}`,
        type: 'WAREHOUSE_ARRIVED',
        title: 'Đã đến kho đích',
        message: `${transfer.shipment.trackingCode} đã đến kho ${transfer.toWarehouse.name}.`,
        data: { shipmentId: transfer.shipmentId, warehouseId: input.warehouseId },
      },
    ]);
    return {
      transfer: await transaction.warehouseTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: warehouseTransferResponseInclude,
      }),
      transitioned: true,
    };
  }

  private async lockTransfer(transaction: Prisma.TransactionClient, transferId: string) {
    await transaction.$queryRaw`
      SELECT "id" FROM "WarehouseTransfer" WHERE "id" = ${transferId}::uuid FOR UPDATE
    `;
  }

  private assertUpdated(count: number, entity: 'Shipment' | 'Transfer'): void {
    if (count !== 1) {
      throw new ConflictException({
        code: `${entity.toUpperCase()}_CONCURRENT_MODIFICATION`,
        message: `${entity} changed concurrently; reload and try again`,
      });
    }
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'TRANSFER_NOT_FOUND',
      message: 'Warehouse transfer not found',
    });
  }
}
