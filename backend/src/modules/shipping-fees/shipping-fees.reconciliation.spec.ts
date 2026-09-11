import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

const feeId = '11111111-1111-4111-8111-111111111111';
const shipmentId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';
const driverUserId = '44444444-4444-4444-8444-444444444444';
const adminId = '55555555-5555-4555-8555-555555555555';
const collectedAt = new Date('2026-09-07T08:00:00.000Z');
const remittedAt = new Date('2026-09-07T09:00:00.000Z');

const driverActor: AuthenticatedUser = {
  id: driverUserId,
  email: 'driver@example.test',
  fullName: 'Driver',
  role: UserRole.DRIVER,
  mustChangePassword: false,
};
const adminActor: AuthenticatedUser = {
  ...driverActor,
  id: adminId,
  email: 'admin@example.test',
  fullName: 'Admin',
  role: UserRole.ADMIN,
};

function collectedFee(overrides: Partial<ShippingFeeTransaction> = {}): ShippingFeeTransaction {
  return {
    id: feeId,
    shipmentId,
    payer: ShippingFeePayer.SENDER,
    expectedAmount: 35_000,
    collectedAmount: 35_000,
    remittedAmount: null,
    paidAmount: null,
    status: ShippingFeeTransactionStatus.COLLECTED,
    collectedByDriverId: driverId,
    remittedByDriverId: null,
    settledById: null,
    collectedAt,
    remittedAt: null,
    settledAt: null,
    paidAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-09-07T07:00:00.000Z'),
    updatedAt: collectedAt,
    ...overrides,
  };
}

function serviceWithTransaction(tx: object): ShippingFeesService {
  return new ShippingFeesService({
    $transaction: jest.fn((callback: (client: object) => unknown) => callback(tx)),
  } as unknown as PrismaService);
}

describe('ShippingFeesService H2 reconciliation', () => {
  it('remits an exact collected amount once with collector ownership and audit', async () => {
    const fee = collectedFee();
    const remitted = collectedFee({
      status: ShippingFeeTransactionStatus.REMITTED,
      remittedAmount: 35_000,
      remittedByDriverId: driverId,
      remittedAt,
    });
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>(() =>
      Promise.resolve({ count: 1 }),
    );
    const auditCreate = jest.fn<(args: unknown) => Promise<object>>(() => Promise.resolve({}));
    const tx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve(fee)),
        updateMany,
        findUniqueOrThrow: jest.fn(() => Promise.resolve(remitted)),
      },
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: driverId })) },
      auditLog: { create: auditCreate },
    };

    await expect(serviceWithTransaction(tx).remit(driverActor, feeId, 35_000, {})).resolves.toEqual(
      remitted,
    );
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: feeId,
        status: ShippingFeeTransactionStatus.COLLECTED,
        expectedAmount: 35_000,
        collectedAmount: 35_000,
        collectedByDriverId: driverId,
      },
      data: {
        status: ShippingFeeTransactionStatus.REMITTED,
        remittedAmount: 35_000,
        remittedByDriverId: driverId,
      },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs: unknown = auditCreate.mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({ data: { action: 'SHIPPING_FEE_REMITTED' } });
  });

  it('rejects wrong remittance actor, amount, role, and state before mutation', async () => {
    const makeTx = (fee: ShippingFeeTransaction, ownerId = driverId) => ({
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve(fee)),
        updateMany: jest.fn(),
      },
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: ownerId })) },
      auditLog: { create: jest.fn() },
    });

    await expect(
      serviceWithTransaction(makeTx(collectedFee(), 'other-driver')).remit(
        driverActor,
        feeId,
        35_000,
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      serviceWithTransaction(makeTx(collectedFee())).remit(driverActor, feeId, 34_999, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      serviceWithTransaction(makeTx(collectedFee())).remit(adminActor, feeId, 35_000, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      serviceWithTransaction(
        makeTx(collectedFee({ status: ShippingFeeTransactionStatus.CANCELLED })),
      ).remit(driverActor, feeId, 35_000, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns an identical committed remittance retry without update or audit', async () => {
    const remitted = collectedFee({
      status: ShippingFeeTransactionStatus.REMITTED,
      remittedAmount: 35_000,
      remittedByDriverId: driverId,
      remittedAt,
    });
    const tx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve(remitted)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(remitted)),
        updateMany: jest.fn(),
      },
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: driverId })) },
      auditLog: { create: jest.fn() },
    };

    await expect(serviceWithTransaction(tx).remit(driverActor, feeId, 35_000, {})).resolves.toEqual(
      remitted,
    );
    expect(tx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('settles only an exactly remitted transaction and rejects active dispute', async () => {
    const remitted = collectedFee({
      status: ShippingFeeTransactionStatus.REMITTED,
      remittedAmount: 35_000,
      remittedByDriverId: driverId,
      remittedAt,
    });
    const settled = {
      ...remitted,
      status: ShippingFeeTransactionStatus.SETTLED,
      settledById: adminId,
      settledAt: new Date('2026-09-07T10:00:00.000Z'),
    };
    const tx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve(remitted)),
        updateMany: jest.fn<(args: unknown) => Promise<{ count: number }>>(() =>
          Promise.resolve({ count: 1 }),
        ),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(settled)),
      },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };

    await expect(serviceWithTransaction(tx).settle(adminActor, feeId, {})).resolves.toEqual(
      settled,
    );
    expect(tx.shippingFeeTransaction.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        status: ShippingFeeTransactionStatus.REMITTED,
        collectedAmount: 35_000,
        remittedAmount: 35_000,
      },
      data: { status: ShippingFeeTransactionStatus.SETTLED, settledById: adminId },
    });

    const disputedTx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() =>
          Promise.resolve(collectedFee({ status: ShippingFeeTransactionStatus.DISPUTED })),
        ),
        updateMany: jest.fn(),
      },
    };
    await expect(serviceWithTransaction(disputedTx).settle(adminActor, feeId, {})).rejects.toThrow(
      ConflictException,
    );
    expect(disputedTx.shippingFeeTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('preserves a reasoned dispute and resolves it back to its explicit source state', async () => {
    const fee = collectedFee();
    const active = {
      id: '66666666-6666-4666-8666-666666666666',
      shippingFeeTransactionId: feeId,
      fromStatus: ShippingFeeTransactionStatus.COLLECTED,
      reason: 'Biên nhận bàn giao chưa rõ',
      openedById: adminId,
      openedAt: new Date(),
      resolvedById: null,
      resolvedAt: null,
      resolutionNote: null,
    };
    const disputed = { ...fee, status: ShippingFeeTransactionStatus.DISPUTED, disputes: [active] };
    const disputeCreate = jest.fn<(args: unknown) => Promise<typeof active>>(() =>
      Promise.resolve(active),
    );
    const disputeTx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve({ ...fee, disputes: [] })),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(disputed)),
      },
      shippingFeeDispute: { create: disputeCreate },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };

    await serviceWithTransaction(disputeTx).dispute(
      adminActor,
      feeId,
      '  Biên nhận bàn giao chưa rõ  ',
      {},
    );
    const disputeCreateArgs: unknown = disputeCreate.mock.calls[0]?.[0];
    expect(disputeCreateArgs).toMatchObject({
      data: {
        fromStatus: ShippingFeeTransactionStatus.COLLECTED,
        reason: 'Biên nhận bàn giao chưa rõ',
      },
    });

    const feeUpdate = jest.fn<(args: unknown) => Promise<{ count: number }>>(() =>
      Promise.resolve({ count: 1 }),
    );
    const disputeUpdate = jest.fn<(args: unknown) => Promise<{ count: number }>>(() =>
      Promise.resolve({ count: 1 }),
    );
    const resolveTx = {
      shippingFeeTransaction: {
        findUnique: jest.fn(() => Promise.resolve(disputed)),
        updateMany: feeUpdate,
        findUniqueOrThrow: jest.fn(() => Promise.resolve(fee)),
      },
      shippingFeeDispute: {
        findFirst: jest.fn(() => Promise.resolve(active)),
        updateMany: disputeUpdate,
      },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    await serviceWithTransaction(resolveTx).resolveDispute(
      adminActor,
      feeId,
      'Đã xác minh biên nhận',
      {},
    );
    expect(resolveTx.shippingFeeTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: feeId, status: ShippingFeeTransactionStatus.DISPUTED },
      data: { status: ShippingFeeTransactionStatus.COLLECTED },
    });
    const disputeUpdateArgs: unknown = disputeUpdate.mock.calls[0]?.[0];
    expect(disputeUpdateArgs).toMatchObject({
      where: { id: active.id, resolvedAt: null },
      data: {
        resolvedById: adminId,
        resolutionNote: 'Đã xác minh biên nhận',
      },
    });
  });

  it('uses database aggregates for filtered reconciliation totals', async () => {
    const groupBy = jest.fn(() =>
      Promise.resolve([
        {
          status: ShippingFeeTransactionStatus.COLLECTED,
          _sum: { expectedAmount: 70_000 },
          _count: { _all: 2 },
        },
      ]),
    );
    const prisma = {
      shippingFeeTransaction: {
        findMany: jest.fn(() => Promise.resolve([])),
        count: jest.fn(() => Promise.resolve(0)),
        groupBy,
      },
    } as unknown as PrismaService;

    const result = await new ShippingFeesService(prisma).reconcile(adminActor, {
      payer: ShippingFeePayer.SENDER,
      page: 1,
      limit: 20,
    });
    expect(result.summary).toContainEqual({
      status: ShippingFeeTransactionStatus.COLLECTED,
      totalAmount: 70_000,
      count: 2,
    });
    expect(result.summary).toContainEqual({
      status: ShippingFeeTransactionStatus.REMITTED,
      totalAmount: 0,
      count: 0,
    });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: { payer: ShippingFeePayer.SENDER },
        _sum: { expectedAmount: true },
      }),
    );
  });
});
