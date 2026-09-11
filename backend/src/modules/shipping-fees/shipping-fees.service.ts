import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  UserRole,
  type Prisma,
  type ShippingFeeTransaction,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import type { ListShippingFeesDto } from './dto/list-shipping-fees.dto.js';

export type ShippingFeeCollectionPoint = 'PICKUP' | 'DELIVERY';

interface ShippingFeeShipmentSnapshot {
  id: string;
  shippingFeePayer: ShippingFeePayer;
  totalFee: number;
  shippingFeeTransaction: ShippingFeeTransaction | null;
}

interface ShippingFeeDriverSnapshot {
  id: string;
  userId: string;
}

@Injectable()
export class ShippingFeesService {
  constructor(private readonly prisma: PrismaService) {}

  createPending(
    tx: Prisma.TransactionClient,
    shipment: { id: string; shippingFeePayer: ShippingFeePayer; totalFee: number },
  ): Promise<ShippingFeeTransaction> {
    this.assertPositiveInteger(shipment.totalFee);
    return tx.shippingFeeTransaction.create({
      data: {
        shipmentId: shipment.id,
        payer: shipment.shippingFeePayer,
        expectedAmount: shipment.totalFee,
      },
    });
  }

  async collectAt(
    tx: Prisma.TransactionClient,
    input: {
      shipment: ShippingFeeShipmentSnapshot;
      driver: ShippingFeeDriverSnapshot;
      actor: AuthenticatedUser;
      amount?: number;
      point: ShippingFeeCollectionPoint;
      collectedAt: Date;
      context: ClientContext;
    },
  ): Promise<ShippingFeeTransaction> {
    this.assertSnapshot(input.shipment);
    this.assertActor(input.actor, input.driver);
    const fee = input.shipment.shippingFeeTransaction!;
    const duePoint =
      fee.payer === ShippingFeePayer.SENDER ? ('PICKUP' as const) : ('DELIVERY' as const);

    if (input.point !== duePoint) {
      if (input.amount !== undefined) {
        throw new BadRequestException({
          code: 'SHIPPING_FEE_NOT_DUE',
          message: `Shipping fee is collected at ${duePoint.toLowerCase()}, not ${input.point.toLowerCase()}`,
        });
      }
      if (
        input.point === 'DELIVERY' &&
        fee.payer === ShippingFeePayer.SENDER &&
        fee.status !== ShippingFeeTransactionStatus.COLLECTED &&
        fee.status !== ShippingFeeTransactionStatus.PAID
      ) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_NOT_COLLECTED',
          message: 'Sender-paid shipping fee must be collected at pickup before delivery',
        });
      }
      return fee;
    }

    if (fee.status === ShippingFeeTransactionStatus.PAYMENT_PENDING) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_PENDING',
        message: 'Shipping fee is awaiting authoritative online-payment confirmation',
      });
    }
    if (fee.status === ShippingFeeTransactionStatus.PAID) {
      if (input.amount !== undefined) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_ALREADY_PAID',
          message: 'Shipping fee was already paid online and must not be collected again',
        });
      }
      this.assertPaidIntegrity(fee);
      return fee;
    }

    this.assertExactAmount(input.amount, fee.expectedAmount);
    if (fee.status === ShippingFeeTransactionStatus.COLLECTED) {
      this.assertIdempotentCollection(fee, input.driver.id, input.amount!);
      return fee;
    }
    if (fee.status !== ShippingFeeTransactionStatus.PENDING) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_STATE_INVALID',
        message: 'Shipping fee is not pending collection',
      });
    }

    const update = await tx.shippingFeeTransaction.updateMany({
      where: {
        id: fee.id,
        shipmentId: input.shipment.id,
        payer: fee.payer,
        expectedAmount: fee.expectedAmount,
        status: ShippingFeeTransactionStatus.PENDING,
        collectedAmount: null,
        collectedByDriverId: null,
      },
      data: {
        collectedAmount: input.amount,
        collectedByDriverId: input.driver.id,
        collectedAt: input.collectedAt,
        status: ShippingFeeTransactionStatus.COLLECTED,
      },
    });
    if (update.count !== 1) {
      const latest = await tx.shippingFeeTransaction.findUnique({ where: { id: fee.id } });
      if (latest?.status === ShippingFeeTransactionStatus.COLLECTED) {
        this.assertIdempotentCollection(latest, input.driver.id, input.amount!);
        return latest;
      }
      throw new ConflictException({
        code: 'SHIPPING_FEE_COLLECTION_CONFLICT',
        message: 'Shipping fee collection changed concurrently; reload and try again',
      });
    }

    const collected: ShippingFeeTransaction = {
      ...fee,
      collectedAmount: input.amount!,
      collectedByDriverId: input.driver.id,
      collectedAt: input.collectedAt,
      status: ShippingFeeTransactionStatus.COLLECTED,
      updatedAt: input.collectedAt,
    };
    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'SHIPPING_FEE_COLLECTED',
        entityType: 'ShippingFeeTransaction',
        entityId: fee.id,
        before: {
          status: fee.status,
          collectedAmount: fee.collectedAmount,
          collectedByDriverId: fee.collectedByDriverId,
        },
        after: {
          status: collected.status,
          collectedAmount: collected.collectedAmount,
          collectedByDriverId: collected.collectedByDriverId,
          collectedAt: collected.collectedAt,
        },
        metadata: {
          shipmentId: input.shipment.id,
          payer: fee.payer,
          collectionPoint: input.point,
        },
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      },
    });
    return collected;
  }

  async cancelPending(
    tx: Prisma.TransactionClient,
    input: {
      shipment: ShippingFeeShipmentSnapshot;
      actor: AuthenticatedUser;
      cancelledAt: Date;
      context: ClientContext;
    },
  ): Promise<void> {
    this.assertSnapshot(input.shipment);
    const fee = input.shipment.shippingFeeTransaction!;
    if (fee.status === ShippingFeeTransactionStatus.CANCELLED) return;
    if (fee.status !== ShippingFeeTransactionStatus.PENDING) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_STATE_INVALID',
        message: 'A collected shipping fee cannot be cancelled',
      });
    }
    const update = await tx.shippingFeeTransaction.updateMany({
      where: { id: fee.id, status: ShippingFeeTransactionStatus.PENDING },
      data: { status: ShippingFeeTransactionStatus.CANCELLED, cancelledAt: input.cancelledAt },
    });
    if (update.count !== 1) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_CANCELLATION_CONFLICT',
        message: 'Shipping fee state changed concurrently; reload and try again',
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'SHIPPING_FEE_CANCELLED',
        entityType: 'ShippingFeeTransaction',
        entityId: fee.id,
        before: { status: fee.status },
        after: { status: ShippingFeeTransactionStatus.CANCELLED, cancelledAt: input.cancelledAt },
        metadata: { shipmentId: input.shipment.id, payer: fee.payer },
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      },
    });
  }

  async listMine(actor: AuthenticatedUser, query: ListShippingFeesDto) {
    this.assertDriverRole(actor);
    const driver = await this.prisma.driverProfile.findUnique({ where: { userId: actor.id } });
    if (!driver) {
      throw new NotFoundException({
        code: 'DRIVER_PROFILE_NOT_FOUND',
        message: 'Driver profile was not found',
      });
    }

    const search = query.search?.trim();
    const baseWhere: Prisma.ShippingFeeTransactionWhereInput = {
      collectedByDriverId: driver.id,
      ...(query.payer ? { payer: query.payer } : {}),
      ...(search ? { shipment: { trackingCode: { contains: search, mode: 'insensitive' } } } : {}),
    };
    const where: Prisma.ShippingFeeTransactionWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total, grouped] = await Promise.all([
      this.prisma.shippingFeeTransaction.findMany({
        where,
        include: {
          shipment: { select: { id: true, trackingCode: true } },
          disputes: {
            where: { resolvedAt: null },
            select: { reason: true, openedAt: true },
            take: 1,
          },
        },
        orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.shippingFeeTransaction.count({ where }),
      this.prisma.shippingFeeTransaction.groupBy({
        by: ['status'],
        where: baseWhere,
        _sum: { expectedAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items: items.map((item) => ({
        ...this.operationalFields(item),
        shipment: item.shipment,
        currentDispute: item.disputes[0] ?? null,
        availableActions: { remit: item.status === ShippingFeeTransactionStatus.COLLECTED },
      })),
      summary: this.toSummary(grouped),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async reconcile(actor: AuthenticatedUser, query: ListShippingFeesDto) {
    this.assertAdmin(actor);
    const search = query.search?.trim();
    const baseWhere: Prisma.ShippingFeeTransactionWhereInput = {
      ...(query.payer ? { payer: query.payer } : {}),
      ...(search
        ? {
            OR: [
              { shipment: { trackingCode: { contains: search, mode: 'insensitive' } } },
              {
                collectedByDriver: {
                  employeeCode: { contains: search, mode: 'insensitive' },
                },
              },
              {
                collectedByDriver: {
                  user: { fullName: { contains: search, mode: 'insensitive' } },
                },
              },
              {
                collectedByDriver: {
                  user: { email: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const where: Prisma.ShippingFeeTransactionWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total, grouped] = await Promise.all([
      this.prisma.shippingFeeTransaction.findMany({
        where,
        include: {
          shipment: {
            select: {
              id: true,
              trackingCode: true,
              senderSnapshot: true,
              receiverSnapshot: true,
            },
          },
          collectedByDriver: {
            select: {
              employeeCode: true,
              user: { select: { fullName: true, email: true } },
            },
          },
          remittedByDriver: {
            select: {
              employeeCode: true,
              user: { select: { fullName: true, email: true } },
            },
          },
          settledBy: { select: { fullName: true, email: true } },
          disputes: {
            where: { resolvedAt: null },
            select: { id: true, reason: true, openedAt: true, fromStatus: true },
            take: 1,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.shippingFeeTransaction.count({ where }),
      this.prisma.shippingFeeTransaction.groupBy({
        by: ['status'],
        where: baseWhere,
        _sum: { expectedAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items: items.map((item) => ({
        ...this.operationalFields(item),
        shipment: {
          id: item.shipment.id,
          trackingCode: item.shipment.trackingCode,
        },
        payerName: this.snapshotPartyName(
          item.payer === ShippingFeePayer.SENDER
            ? item.shipment.senderSnapshot
            : item.shipment.receiverSnapshot,
        ),
        collector: item.collectedByDriver,
        remitter: item.remittedByDriver,
        settler: item.settledBy,
        currentDispute: item.disputes[0] ?? null,
        availableActions: {
          settle: item.status === ShippingFeeTransactionStatus.REMITTED,
          dispute:
            item.status === ShippingFeeTransactionStatus.COLLECTED ||
            item.status === ShippingFeeTransactionStatus.REMITTED,
          resolve: item.status === ShippingFeeTransactionStatus.DISPUTED,
        },
      })),
      summary: this.toSummary(grouped),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async remit(actor: AuthenticatedUser, id: string, amount: number, context: ClientContext) {
    this.assertDriverRole(actor);
    return this.prisma.$transaction(async (tx) => {
      const fee = await tx.shippingFeeTransaction.findUnique({ where: { id } });
      if (!fee) this.notFound();
      const driver = await tx.driverProfile.findUnique({ where: { userId: actor.id } });
      if (!driver || fee.collectedByDriverId !== driver.id) {
        throw new NotFoundException({
          code: 'SHIPPING_FEE_COLLECTION_NOT_FOUND',
          message: 'Shipping fee collection owned by this Driver was not found',
        });
      }
      this.assertExactAmount(amount, fee.expectedAmount);
      this.assertCollectedIntegrity(fee);

      if (
        fee.status === ShippingFeeTransactionStatus.REMITTED ||
        fee.status === ShippingFeeTransactionStatus.SETTLED ||
        fee.status === ShippingFeeTransactionStatus.DISPUTED
      ) {
        if (
          fee.remittedAmount === amount &&
          fee.remittedByDriverId === driver.id &&
          fee.remittedAt
        ) {
          return this.findDriverItem(tx, fee.id);
        }
        throw new ConflictException({
          code: 'SHIPPING_FEE_REMITTANCE_CONFLICT',
          message: 'Shipping fee was already changed by a different remittance',
        });
      }
      if (fee.status !== ShippingFeeTransactionStatus.COLLECTED) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_STATE_INVALID',
          message: 'Only a collected shipping fee can be remitted',
        });
      }

      const remittedAt = new Date();
      const changed = await tx.shippingFeeTransaction.updateMany({
        where: {
          id: fee.id,
          status: ShippingFeeTransactionStatus.COLLECTED,
          expectedAmount: fee.expectedAmount,
          collectedAmount: fee.expectedAmount,
          collectedByDriverId: driver.id,
          remittedAmount: null,
          remittedByDriverId: null,
          remittedAt: null,
        },
        data: {
          status: ShippingFeeTransactionStatus.REMITTED,
          remittedAmount: amount,
          remittedByDriverId: driver.id,
          remittedAt,
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.shippingFeeTransaction.findUniqueOrThrow({ where: { id: fee.id } });
        if (
          latest.remittedAmount === amount &&
          latest.remittedByDriverId === driver.id &&
          latest.remittedAt &&
          (latest.status === ShippingFeeTransactionStatus.REMITTED ||
            latest.status === ShippingFeeTransactionStatus.SETTLED ||
            latest.status === ShippingFeeTransactionStatus.DISPUTED)
        ) {
          return this.findDriverItem(tx, fee.id);
        }
        this.concurrentModification();
      }
      await this.audit(tx, actor, context, 'SHIPPING_FEE_REMITTED', fee.id, {
        before: { status: fee.status, remittedAmount: fee.remittedAmount },
        after: {
          status: ShippingFeeTransactionStatus.REMITTED,
          remittedAmount: amount,
          remittedByDriverId: driver.id,
          remittedAt,
        },
        metadata: { shipmentId: fee.shipmentId },
      });
      return this.findDriverItem(tx, fee.id);
    });
  }

  async settle(actor: AuthenticatedUser, id: string, context: ClientContext) {
    this.assertAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      const fee = await tx.shippingFeeTransaction.findUnique({ where: { id } });
      if (!fee) this.notFound();
      if (fee.status === ShippingFeeTransactionStatus.SETTLED) {
        this.assertRemittedIntegrity(fee);
        return this.findAdminItem(tx, fee.id);
      }
      if (fee.status === ShippingFeeTransactionStatus.DISPUTED) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_ACTIVE',
          message: 'Resolve the active shipping fee dispute before settlement',
        });
      }
      if (fee.status !== ShippingFeeTransactionStatus.REMITTED) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_STATE_INVALID',
          message: 'Only a remitted shipping fee can be settled',
        });
      }
      this.assertRemittedIntegrity(fee);

      const settledAt = new Date();
      const changed = await tx.shippingFeeTransaction.updateMany({
        where: {
          id: fee.id,
          status: ShippingFeeTransactionStatus.REMITTED,
          expectedAmount: fee.expectedAmount,
          collectedAmount: fee.expectedAmount,
          remittedAmount: fee.expectedAmount,
          settledById: null,
          settledAt: null,
        },
        data: {
          status: ShippingFeeTransactionStatus.SETTLED,
          settledById: actor.id,
          settledAt,
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.shippingFeeTransaction.findUniqueOrThrow({ where: { id: fee.id } });
        if (latest.status === ShippingFeeTransactionStatus.SETTLED) {
          return this.findAdminItem(tx, fee.id);
        }
        this.concurrentModification();
      }
      await this.audit(tx, actor, context, 'SHIPPING_FEE_SETTLED', fee.id, {
        before: { status: fee.status },
        after: {
          status: ShippingFeeTransactionStatus.SETTLED,
          settledById: actor.id,
          settledAt,
        },
        metadata: { shipmentId: fee.shipmentId, amount: fee.expectedAmount },
      });
      return this.findAdminItem(tx, fee.id);
    });
  }

  async dispute(actor: AuthenticatedUser, id: string, rawReason: string, context: ClientContext) {
    this.assertAdmin(actor);
    const reason = this.requiredText(rawReason, 'SHIPPING_FEE_DISPUTE_REASON_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      const fee = await tx.shippingFeeTransaction.findUnique({
        where: { id },
        include: { disputes: { where: { resolvedAt: null }, take: 1 } },
      });
      if (!fee) this.notFound();
      const activeDispute = fee.disputes[0];
      if (fee.status === ShippingFeeTransactionStatus.DISPUTED) {
        if (activeDispute?.openedById === actor.id && activeDispute.reason === reason) {
          return this.findAdminItem(tx, fee.id);
        }
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_ACTIVE',
          message: 'A different shipping fee dispute is already active',
        });
      }
      if (
        fee.status !== ShippingFeeTransactionStatus.COLLECTED &&
        fee.status !== ShippingFeeTransactionStatus.REMITTED
      ) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_STATE_INVALID',
          message: 'Only a collected or remitted shipping fee can be disputed',
        });
      }
      this.assertCollectedIntegrity(fee);
      if (fee.status === ShippingFeeTransactionStatus.REMITTED) this.assertRemittedIntegrity(fee);
      if (activeDispute) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_INCONSISTENT',
          message: 'Shipping fee dispute history is inconsistent with its current status',
        });
      }

      const openedAt = new Date();
      const fromStatus = fee.status;
      const changed = await tx.shippingFeeTransaction.updateMany({
        where: { id: fee.id, status: fromStatus },
        data: { status: ShippingFeeTransactionStatus.DISPUTED },
      });
      if (changed.count !== 1) this.concurrentModification();
      const dispute = await tx.shippingFeeDispute.create({
        data: {
          shippingFeeTransactionId: fee.id,
          fromStatus,
          reason,
          openedById: actor.id,
          openedAt,
        },
      });
      await this.audit(tx, actor, context, 'SHIPPING_FEE_DISPUTED', fee.id, {
        before: { status: fromStatus },
        after: { status: ShippingFeeTransactionStatus.DISPUTED },
        metadata: { shipmentId: fee.shipmentId, disputeId: dispute.id, reason },
      });
      return this.findAdminItem(tx, fee.id);
    });
  }

  async resolveDispute(
    actor: AuthenticatedUser,
    id: string,
    rawResolutionNote: string,
    context: ClientContext,
  ) {
    this.assertAdmin(actor);
    const resolutionNote = this.requiredText(
      rawResolutionNote,
      'SHIPPING_FEE_RESOLUTION_NOTE_REQUIRED',
    );
    return this.prisma.$transaction(async (tx) => {
      const fee = await tx.shippingFeeTransaction.findUnique({ where: { id } });
      if (!fee) this.notFound();
      const activeDispute = await tx.shippingFeeDispute.findFirst({
        where: { shippingFeeTransactionId: fee.id, resolvedAt: null },
        orderBy: { openedAt: 'desc' },
      });
      if (fee.status !== ShippingFeeTransactionStatus.DISPUTED || !activeDispute) {
        const latestResolved = await tx.shippingFeeDispute.findFirst({
          where: { shippingFeeTransactionId: fee.id, resolvedAt: { not: null } },
          orderBy: { resolvedAt: 'desc' },
        });
        if (
          latestResolved?.resolvedById === actor.id &&
          latestResolved.resolutionNote === resolutionNote
        ) {
          return this.findAdminItem(tx, fee.id);
        }
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_NOT_ACTIVE',
          message: 'Shipping fee does not have an active dispute to resolve',
        });
      }
      if (
        activeDispute.fromStatus !== ShippingFeeTransactionStatus.COLLECTED &&
        activeDispute.fromStatus !== ShippingFeeTransactionStatus.REMITTED
      ) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_INCONSISTENT',
          message: 'Shipping fee dispute has an invalid source state',
        });
      }
      this.assertCollectedIntegrity(fee);
      if (activeDispute.fromStatus === ShippingFeeTransactionStatus.REMITTED) {
        this.assertRemittedIntegrity(fee);
      } else if (fee.remittedAmount !== null || fee.remittedByDriverId || fee.remittedAt) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_DISPUTE_INCONSISTENT',
          message: 'Collected shipping fee dispute contains unexpected remittance data',
        });
      }

      const resolvedAt = new Date();
      const changed = await tx.shippingFeeTransaction.updateMany({
        where: { id: fee.id, status: ShippingFeeTransactionStatus.DISPUTED },
        data: { status: activeDispute.fromStatus },
      });
      if (changed.count !== 1) this.concurrentModification();
      const disputeChanged = await tx.shippingFeeDispute.updateMany({
        where: { id: activeDispute.id, resolvedAt: null },
        data: { resolvedById: actor.id, resolvedAt, resolutionNote },
      });
      if (disputeChanged.count !== 1) this.concurrentModification();
      await this.audit(tx, actor, context, 'SHIPPING_FEE_DISPUTE_RESOLVED', fee.id, {
        before: { status: ShippingFeeTransactionStatus.DISPUTED },
        after: { status: activeDispute.fromStatus },
        metadata: {
          shipmentId: fee.shipmentId,
          disputeId: activeDispute.id,
          resolutionNote,
        },
      });
      return this.findAdminItem(tx, fee.id);
    });
  }

  private assertSnapshot(shipment: ShippingFeeShipmentSnapshot): void {
    const fee = shipment.shippingFeeTransaction;
    if (
      !fee ||
      fee.shipmentId !== shipment.id ||
      fee.payer !== shipment.shippingFeePayer ||
      fee.expectedAmount !== shipment.totalFee
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_SNAPSHOT_INVALID',
        message: 'Shipping fee snapshot is missing or inconsistent with the shipment',
      });
    }
    this.assertPositiveInteger(fee.expectedAmount);
  }

  private assertDriverRole(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.DRIVER) {
      throw new ForbiddenException({
        code: 'SHIPPING_FEE_ACTOR_FORBIDDEN',
        message: 'Only a Driver can remit an owned shipping fee collection',
      });
    }
  }

  private assertAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        code: 'SHIPPING_FEE_ADMIN_REQUIRED',
        message: 'Only an Admin can reconcile shipping fees',
      });
    }
  }

  private assertCollectedIntegrity(fee: ShippingFeeTransaction): void {
    this.assertPositiveInteger(fee.expectedAmount);
    if (
      fee.collectedAmount !== fee.expectedAmount ||
      !fee.collectedByDriverId ||
      !fee.collectedAt
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_AMOUNT_MISMATCH',
        message: 'Collected shipping fee does not match its immutable expected amount',
      });
    }
  }

  private assertRemittedIntegrity(fee: ShippingFeeTransaction): void {
    this.assertCollectedIntegrity(fee);
    if (fee.remittedAmount !== fee.expectedAmount || !fee.remittedByDriverId || !fee.remittedAt) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_AMOUNT_MISMATCH',
        message: 'Remitted shipping fee does not match its immutable expected amount',
      });
    }
  }

  private assertPaidIntegrity(fee: ShippingFeeTransaction): void {
    this.assertPositiveInteger(fee.expectedAmount);
    if (
      fee.paidAmount !== fee.expectedAmount ||
      !fee.paidAt ||
      fee.collectedAmount !== null ||
      fee.collectedByDriverId ||
      fee.collectedAt ||
      fee.remittedAmount !== null ||
      fee.remittedByDriverId ||
      fee.remittedAt ||
      fee.settledById ||
      fee.settledAt
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_AMOUNT_MISMATCH',
        message: 'Online-paid shipping fee does not match its immutable expected amount',
      });
    }
  }

  private requiredText(value: string, code: string): string {
    const normalized = value.trim();
    if (normalized.length < 3 || normalized.length > 500) {
      throw new BadRequestException({
        code,
        message: 'A reason of 3 to 500 characters is required',
      });
    }
    return normalized;
  }

  private operationalFields(fee: ShippingFeeTransaction) {
    return {
      id: fee.id,
      payer: fee.payer,
      expectedAmount: fee.expectedAmount,
      collectedAmount: fee.collectedAmount,
      remittedAmount: fee.remittedAmount,
      paidAmount: fee.paidAmount,
      status: fee.status,
      collectedAt: fee.collectedAt,
      remittedAt: fee.remittedAt,
      settledAt: fee.settledAt,
      paidAt: fee.paidAt,
      createdAt: fee.createdAt,
    };
  }

  private toSummary(
    grouped: Array<{
      status: ShippingFeeTransactionStatus;
      _sum: { expectedAmount: number | null };
      _count: { _all: number };
    }>,
  ) {
    return Object.values(ShippingFeeTransactionStatus).map((status) => {
      const item = grouped.find((candidate) => candidate.status === status);
      return {
        status,
        totalAmount: item?._sum.expectedAmount ?? 0,
        count: item?._count._all ?? 0,
      };
    });
  }

  private snapshotPartyName(snapshot: Prisma.JsonValue): string | null {
    if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') return null;
    const contactName = snapshot.contactName;
    return typeof contactName === 'string' && contactName.trim() ? contactName : null;
  }

  private findDriverItem(tx: Prisma.TransactionClient, id: string) {
    return tx.shippingFeeTransaction.findUniqueOrThrow({
      where: { id },
      include: {
        shipment: { select: { id: true, trackingCode: true } },
        disputes: {
          where: { resolvedAt: null },
          select: { reason: true, openedAt: true },
          take: 1,
        },
      },
    });
  }

  private findAdminItem(tx: Prisma.TransactionClient, id: string) {
    return tx.shippingFeeTransaction.findUniqueOrThrow({
      where: { id },
      include: {
        shipment: { select: { id: true, trackingCode: true } },
        collectedByDriver: {
          select: {
            employeeCode: true,
            user: { select: { fullName: true, email: true } },
          },
        },
        remittedByDriver: {
          select: {
            employeeCode: true,
            user: { select: { fullName: true, email: true } },
          },
        },
        settledBy: { select: { fullName: true, email: true } },
        disputes: {
          where: { resolvedAt: null },
          select: { id: true, reason: true, openedAt: true, fromStatus: true },
          take: 1,
        },
      },
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    context: ClientContext,
    action: string,
    entityId: string,
    change: {
      before: Prisma.InputJsonValue;
      after: Prisma.InputJsonValue;
      metadata: Prisma.InputJsonValue;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action,
        entityType: 'ShippingFeeTransaction',
        entityId,
        before: change.before,
        after: change.after,
        metadata: change.metadata,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'SHIPPING_FEE_TRANSACTION_NOT_FOUND',
      message: 'Shipping fee transaction was not found',
    });
  }

  private concurrentModification(): never {
    throw new ConflictException({
      code: 'SHIPPING_FEE_CONCURRENT_MODIFICATION',
      message: 'Shipping fee transaction changed concurrently; reload and try again',
    });
  }

  private assertActor(actor: AuthenticatedUser, driver: ShippingFeeDriverSnapshot): void {
    if (actor.role !== UserRole.DRIVER || actor.id !== driver.userId) {
      throw new ForbiddenException({
        code: 'SHIPPING_FEE_ACTOR_FORBIDDEN',
        message: 'Only the driver who owns this operation can collect its shipping fee',
      });
    }
  }

  private assertExactAmount(amount: number | undefined, expectedAmount: number): void {
    if (!Number.isSafeInteger(amount) || amount !== expectedAmount) {
      throw new BadRequestException({
        code: 'SHIPPING_FEE_AMOUNT_MISMATCH',
        message: `Shipping fee amount must equal ${expectedAmount} VND`,
      });
    }
  }

  private assertPositiveInteger(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_AMOUNT_INVALID',
        message: 'Shipping fee snapshot must be a positive integer VND amount',
      });
    }
  }

  private assertIdempotentCollection(
    fee: ShippingFeeTransaction,
    driverId: string,
    amount: number,
  ): void {
    if (
      fee.collectedAmount !== amount ||
      fee.collectedAmount !== fee.expectedAmount ||
      fee.collectedByDriverId !== driverId ||
      !fee.collectedAt
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_COLLECTION_CONFLICT',
        message: 'Shipping fee was already collected by a different actor or amount',
      });
    }
  }
}
