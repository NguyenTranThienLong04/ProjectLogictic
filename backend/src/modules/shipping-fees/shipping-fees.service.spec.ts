import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  UserRole,
  type ShippingFeeTransaction,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ShippingFeesService } from './shipping-fees.service.js';

const shipmentId = '11111111-1111-4111-8111-111111111111';
const transactionId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';
const driverUserId = '44444444-4444-4444-8444-444444444444';
const collectedAt = new Date('2026-09-07T03:00:00.000Z');
const actor: AuthenticatedUser = {
  id: driverUserId,
  email: 'driver@example.test',
  fullName: 'Driver',
  role: UserRole.DRIVER,
  mustChangePassword: false,
};

function fee(overrides: Partial<ShippingFeeTransaction> = {}): ShippingFeeTransaction {
  return {
    id: transactionId,
    shipmentId,
    payer: ShippingFeePayer.SENDER,
    expectedAmount: 35_000,
    collectedAmount: null,
    remittedAmount: null,
    paidAmount: null,
    status: ShippingFeeTransactionStatus.PENDING,
    collectedByDriverId: null,
    remittedByDriverId: null,
    settledById: null,
    collectedAt: null,
    remittedAt: null,
    settledAt: null,
    paidAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    updatedAt: new Date('2026-09-07T02:00:00.000Z'),
    ...overrides,
  };
}

function input(transaction = fee()) {
  return {
    shipment: {
      id: shipmentId,
      shippingFeePayer: transaction.payer,
      totalFee: transaction.expectedAmount,
      shippingFeeTransaction: transaction,
    },
    driver: { id: driverId, userId: driverUserId },
    actor,
    amount: 35_000,
    point: 'PICKUP' as const,
    collectedAt,
    context: { ipAddress: '127.0.0.1', userAgent: 'unit-test' },
  };
}

function transaction(updateCount = 1, latest: ShippingFeeTransaction | null = null) {
  return {
    shippingFeeTransaction: {
      updateMany: jest.fn(() => Promise.resolve({ count: updateCount })),
      findUnique: jest.fn(() => Promise.resolve(latest)),
      create: jest.fn(() => Promise.resolve(fee())),
    },
    auditLog: { create: jest.fn((value: unknown) => Promise.resolve(value)) },
  };
}

describe('ShippingFeesService', () => {
  const service = new ShippingFeesService({} as PrismaService);

  it('snapshots the exact shipment pricing total in a separate pending transaction', async () => {
    const tx = transaction();

    await service.createPending(tx as never, {
      id: shipmentId,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
      totalFee: 42_000,
    });

    expect(tx.shippingFeeTransaction.create).toHaveBeenCalledWith({
      data: {
        shipmentId,
        payer: ShippingFeePayer.RECEIVER,
        expectedAmount: 42_000,
      },
    });
  });

  it('collects a sender fee at pickup with exact integer VND and one audit record', async () => {
    const tx = transaction();

    const result = await service.collectAt(tx as never, input());

    expect(result).toMatchObject({
      status: ShippingFeeTransactionStatus.COLLECTED,
      collectedAmount: 35_000,
      collectedByDriverId: driverId,
      collectedAt,
    });
    expect(tx.shippingFeeTransaction.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        action: 'SHIPPING_FEE_COLLECTED',
        entityType: 'ShippingFeeTransaction',
        entityId: transactionId,
      },
    });
  });

  it('collects a receiver fee only at successful delivery point', async () => {
    const receiverFee = fee({ payer: ShippingFeePayer.RECEIVER });
    const pickupTx = transaction();
    const pickupInput = input(receiverFee);

    await expect(
      service.collectAt(pickupTx as never, {
        ...pickupInput,
        point: 'PICKUP',
        amount: undefined,
      }),
    ).resolves.toBe(receiverFee);
    expect(pickupTx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();

    const deliveryTx = transaction();
    await expect(
      service.collectAt(deliveryTx as never, {
        ...pickupInput,
        point: 'DELIVERY',
      }),
    ).resolves.toMatchObject({ status: ShippingFeeTransactionStatus.COLLECTED });
  });

  it('rejects missing, fractional, or mismatched amounts without collecting', async () => {
    for (const amount of [undefined, 35_000.5, 34_999]) {
      const tx = transaction();
      await expect(service.collectAt(tx as never, { ...input(), amount })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it('rejects an actor who does not own the driver operation', async () => {
    const tx = transaction();
    await expect(
      service.collectAt(tx as never, {
        ...input(),
        actor: { ...actor, id: '55555555-5555-4555-8555-555555555555' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('returns an identical committed collection on retry without another update or audit', async () => {
    const collected = fee({
      status: ShippingFeeTransactionStatus.COLLECTED,
      collectedAmount: 35_000,
      collectedByDriverId: driverId,
      collectedAt,
    });
    const tx = transaction();

    await expect(service.collectAt(tx as never, input(collected))).resolves.toBe(collected);
    expect(tx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('treats authoritative online payment as satisfied and never collects it again', async () => {
    const paid = fee({
      status: ShippingFeeTransactionStatus.PAID,
      paidAmount: 35_000,
      paidAt: collectedAt,
    });
    const tx = transaction();

    await expect(
      service.collectAt(tx as never, { ...input(paid), amount: undefined }),
    ).resolves.toBe(paid);
    expect(tx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    await expect(service.collectAt(tx as never, input(paid))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects inconsistent snapshots and duplicate collections by another driver', async () => {
    const tx = transaction();
    await expect(
      service.collectAt(tx as never, {
        ...input(),
        shipment: { ...input().shipment, totalFee: 35_001 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const collected = fee({
      status: ShippingFeeTransactionStatus.COLLECTED,
      collectedAmount: 35_000,
      collectedByDriverId: '66666666-6666-4666-8666-666666666666',
      collectedAt,
    });
    await expect(service.collectAt(tx as never, input(collected))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
