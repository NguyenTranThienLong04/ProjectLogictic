import { ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { DriverStatus, UserRole, UserStatus } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DriversService } from './drivers.service.js';

const driverUserId = '29bb510a-c663-4bfe-99da-d0e6ac69fc14';
const actor: AuthenticatedUser = {
  id: driverUserId,
  email: 'driver@example.com',
  fullName: 'Pickup Driver',
  role: UserRole.DRIVER,
  mustChangePassword: false,
};

function profile(status: DriverStatus) {
  const now = new Date('2026-08-17T10:00:00.000Z');
  return {
    id: 'b9c38898-5059-4275-8a7a-087672436d93',
    userId: driverUserId,
    employeeCode: 'DRV-001',
    vehicleType: 'Motorbike',
    vehiclePlate: '59A1-12345',
    status,
    isOnline: status === DriverStatus.AVAILABLE,
    isAvailable: status === DriverStatus.AVAILABLE,
    version: 0,
    createdAt: now,
    updatedAt: now,
    user: {
      id: driverUserId,
      email: actor.email,
      passwordHash: 'hash',
      fullName: actor.fullName,
      phone: null,
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      tokenVersion: 0,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe('DriversService', () => {
  it('prevents a suspended profile from becoming available', async () => {
    const transaction = {
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve(profile(DriverStatus.SUSPENDED))),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new DriversService(prisma).setAvailability(actor, true, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sets an eligible driver available atomically and audits the change', async () => {
    const offline = profile(DriverStatus.OFFLINE);
    const available = {
      ...offline,
      status: DriverStatus.AVAILABLE,
      isOnline: true,
      isAvailable: true,
    };
    const transaction = {
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve(offline)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...available, version: 1 })),
      },
      driverAssignment: { count: jest.fn(() => Promise.resolve(0)) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new DriversService(prisma).setAvailability(actor, true, {});

    expect(result.status).toBe(DriverStatus.AVAILABLE);
    const updateCalls = transaction.driverProfile.updateMany.mock.calls as unknown as Array<
      [{ data: { status: DriverStatus; isOnline: boolean; isAvailable: boolean } }]
    >;
    const updateCall = updateCalls[0][0];
    expect(updateCall.data).toMatchObject({
      status: DriverStatus.AVAILABLE,
      isOnline: true,
      isAvailable: true,
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale availability change before writing audit history', async () => {
    const offline = profile(DriverStatus.OFFLINE);
    const transaction = {
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve(offline)),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      driverAssignment: { count: jest.fn(() => Promise.resolve(0)) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new DriversService(prisma).setAvailability(actor, true, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not change operating warehouse while the driver owns an active assignment', async () => {
    const current = {
      ...profile(DriverStatus.BUSY),
      operatingWarehouseId: '11111111-1111-4111-8111-111111111111',
      operatingWarehouse: null,
    };
    const transaction = {
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(),
      },
      driverAssignment: { count: jest.fn(() => Promise.resolve(1)) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new DriversService(prisma).update(
        actor,
        current.id,
        { operatingWarehouseId: '22222222-2222-4222-8222-222222222222' },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.driverProfile.updateMany).not.toHaveBeenCalled();
  });
});
