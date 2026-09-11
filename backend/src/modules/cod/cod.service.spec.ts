import { ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { CODTransactionStatus, UserRole } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { CodService } from './cod.service.js';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  role: UserRole.ADMIN,
  email: 'admin@example.test',
  fullName: 'Admin',
  mustChangePassword: false,
};
const driverActor = { ...actor, role: UserRole.DRIVER };
const codId = '22222222-2222-4222-8222-222222222222';
const shipmentId = '33333333-3333-4333-8333-333333333333';
const driverProfileId = '44444444-4444-4444-8444-444444444444';

function transaction(prisma: PrismaService) {
  return new CodService(prisma);
}

describe('CodService concurrency guards', () => {
  it('remits with a conditional COLLECTED update and does not audit a lost race', async () => {
    const cod = {
      id: codId,
      shipmentId,
      expectedAmount: 150_000,
      collectedAmount: 150_000,
      remittedAmount: null,
      status: CODTransactionStatus.COLLECTED,
      collectedByDriverId: driverProfileId,
    };
    const latest = {
      ...cod,
      remittedAmount: 140_000,
      status: CODTransactionStatus.DISPUTED,
    };
    const updateMany = jest.fn<
      (args: {
        where: { id: string; status: CODTransactionStatus };
        data: { remittedAmount: number; remittedAt: Date; status: CODTransactionStatus };
      }) => Promise<{ count: number }>
    >(() => Promise.resolve({ count: 0 }));
    const tx = {
      cODTransaction: {
        findUnique: jest.fn(() => Promise.resolve(cod)),
        updateMany,
        findUniqueOrThrow: jest.fn(() => Promise.resolve(latest)),
      },
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve({ id: driverProfileId })),
      },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await expect(transaction(prisma).remit(driverActor, shipmentId, 150_000, {})).rejects.toThrow(
      ConflictException,
    );
    const update = updateMany.mock.calls[0]?.[0];
    expect(update?.where).toEqual({ id: codId, status: CODTransactionStatus.COLLECTED });
    expect(update?.data).toMatchObject({
      remittedAmount: 150_000,
      status: CODTransactionStatus.REMITTED,
    });
    expect(update?.data.remittedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('settles only when status and both money fields still match in the atomic update', async () => {
    const cod = {
      id: codId,
      shipmentId,
      expectedAmount: 150_000,
      collectedAmount: 150_000,
      remittedAmount: 150_000,
      status: CODTransactionStatus.REMITTED,
    };
    const settled = { ...cod, status: CODTransactionStatus.SETTLED, settledAt: new Date() };
    const updateMany = jest.fn<
      (args: {
        where: {
          id: string;
          status: CODTransactionStatus;
          collectedAmount: number;
          remittedAmount: number;
        };
        data: { status: CODTransactionStatus; settledAt: Date };
      }) => Promise<{ count: number }>
    >(() => Promise.resolve({ count: 1 }));
    const tx = {
      cODTransaction: {
        findUnique: jest.fn(() => Promise.resolve(cod)),
        updateMany,
        findUniqueOrThrow: jest.fn(() => Promise.resolve(settled)),
      },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await expect(transaction(prisma).settle(actor, codId, {})).resolves.toEqual(settled);
    const update = updateMany.mock.calls[0]?.[0];
    expect(update?.where).toEqual({
      id: codId,
      status: CODTransactionStatus.REMITTED,
      collectedAmount: 150_000,
      remittedAmount: 150_000,
    });
    expect(update?.data.status).toBe(CODTransactionStatus.SETTLED);
    expect(update?.data.settledAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not execute the settlement update when either amount mismatches', async () => {
    const tx = {
      cODTransaction: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: codId,
            expectedAmount: 150_000,
            collectedAmount: 150_000,
            remittedAmount: 149_000,
            status: CODTransactionStatus.REMITTED,
          }),
        ),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await expect(transaction(prisma).settle(actor, codId, {})).rejects.toThrow(ConflictException);
    expect(tx.cODTransaction.updateMany).not.toHaveBeenCalled();
  });
});
