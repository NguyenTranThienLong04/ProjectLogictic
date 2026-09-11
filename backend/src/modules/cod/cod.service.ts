import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CODTransactionStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';

@Injectable()
export class CodService {
  constructor(private readonly prisma: PrismaService) {}

  async remit(
    actor: AuthenticatedUser,
    shipmentId: string,
    amount: number,
    context: ClientContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cod = await tx.cODTransaction.findUnique({ where: { shipmentId } });
      if (!cod)
        throw new NotFoundException({
          code: 'COD_TRANSACTION_NOT_FOUND',
          message: 'COD transaction was not found',
        });
      const driver = await tx.driverProfile.findUnique({ where: { userId: actor.id } });
      if (!driver || cod.collectedByDriverId !== driver.id)
        throw new NotFoundException({
          code: 'COD_COLLECTION_NOT_FOUND',
          message: 'COD collection owned by this driver was not found',
        });
      if (cod.status !== CODTransactionStatus.COLLECTED)
        throw new ConflictException({
          code: 'COD_STATE_INVALID',
          message: 'COD transaction cannot be remitted',
        });
      const next =
        amount === cod.expectedAmount
          ? CODTransactionStatus.REMITTED
          : CODTransactionStatus.DISPUTED;
      const changed = await tx.cODTransaction.updateMany({
        where: { id: cod.id, status: CODTransactionStatus.COLLECTED },
        data: { remittedAmount: amount, remittedAt: new Date(), status: next },
      });
      if (changed.count !== 1) return this.resolveRemittanceRace(tx, cod.id, amount);
      await this.audit(
        tx,
        actor,
        context,
        next === CODTransactionStatus.DISPUTED ? 'COD_DISPUTED' : 'COD_REMITTED',
        cod.id,
        { expectedAmount: cod.expectedAmount, remittedAmount: amount },
      );
      return tx.cODTransaction.findUniqueOrThrow({ where: { id: cod.id } });
    });
  }

  async settle(actor: AuthenticatedUser, id: string, context: ClientContext) {
    return this.prisma.$transaction(async (tx) => {
      const cod = await tx.cODTransaction.findUnique({ where: { id } });
      if (!cod)
        throw new NotFoundException({
          code: 'COD_TRANSACTION_NOT_FOUND',
          message: 'COD transaction was not found',
        });
      if (
        cod.status !== CODTransactionStatus.REMITTED ||
        cod.collectedAmount !== cod.expectedAmount ||
        cod.remittedAmount !== cod.expectedAmount
      )
        throw new ConflictException({
          code: 'COD_AMOUNT_MISMATCH',
          message: 'COD with a mismatched amount cannot be settled',
        });
      const changed = await tx.cODTransaction.updateMany({
        where: {
          id,
          status: CODTransactionStatus.REMITTED,
          collectedAmount: cod.expectedAmount,
          remittedAmount: cod.expectedAmount,
        },
        data: { status: CODTransactionStatus.SETTLED, settledAt: new Date() },
      });
      if (changed.count !== 1) {
        const latest = await tx.cODTransaction.findUniqueOrThrow({ where: { id } });
        if (latest.status === CODTransactionStatus.SETTLED) return latest;
        throw new ConflictException({
          code: 'COD_CONCURRENT_MODIFICATION',
          message: 'COD transaction changed concurrently; reload and try again',
        });
      }
      await this.audit(tx, actor, context, 'COD_SETTLED', id, { amount: cod.expectedAmount });
      return tx.cODTransaction.findUniqueOrThrow({ where: { id } });
    });
  }

  async dashboard() {
    const [items, grouped] = await Promise.all([
      this.prisma.cODTransaction.findMany({
        include: {
          shipment: { select: { trackingCode: true } },
          collectedByDriver: { include: { user: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.cODTransaction.groupBy({
        by: ['status'],
        _sum: { expectedAmount: true },
        _count: { _all: true },
      }),
    ]);
    return { items, summary: grouped };
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    context: ClientContext,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action,
        entityType: 'CODTransaction',
        entityId,
        metadata,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  private async resolveRemittanceRace(tx: Prisma.TransactionClient, id: string, amount: number) {
    const latest = await tx.cODTransaction.findUniqueOrThrow({ where: { id } });
    if (
      (latest.status === CODTransactionStatus.REMITTED ||
        latest.status === CODTransactionStatus.DISPUTED ||
        latest.status === CODTransactionStatus.SETTLED) &&
      latest.remittedAmount === amount
    )
      return latest;
    throw new ConflictException({
      code: 'COD_CONCURRENT_MODIFICATION',
      message: 'COD transaction changed concurrently; reload and try again',
    });
  }
}
