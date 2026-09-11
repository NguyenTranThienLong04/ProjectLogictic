import { jest } from '@jest/globals';
import { UserRole, UserStatus } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { PasswordHasherService } from '../auth/password-hasher.service.js';
import { UsersService } from './users.service.js';

describe('UsersService audit coverage', () => {
  it('creates a staff account and its actor-attributed audit record atomically', async () => {
    const now = new Date();
    const created = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'dispatcher@example.test',
      passwordHash: 'temporary-hash',
      fullName: 'Dispatcher',
      phone: null,
      role: UserRole.DISPATCHER,
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
      tokenVersion: 0,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const transaction = {
      user: { create: jest.fn(() => Promise.resolve(created)) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const transactionRunner = jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    );
    const prisma = { $transaction: transactionRunner } as unknown as PrismaService;
    const hasher = {
      hash: jest.fn(() => Promise.resolve('temporary-hash')),
    } as unknown as PasswordHasherService;
    const actor = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.test',
      fullName: 'Admin',
      role: UserRole.ADMIN,
      mustChangePassword: false,
    };

    await new UsersService(prisma, hasher).createStaff(
      actor,
      {
        email: created.email,
        fullName: created.fullName,
        role: UserRole.DISPATCHER,
        temporaryPassword: 'Password@123456',
      },
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
    );

    const auditCalls = transaction.auditLog.create.mock.calls as unknown as Array<
      [{ data: { actorId: string; action: string; entityId: string } }]
    >;
    expect(auditCalls[0][0].data).toMatchObject({
      actorId: actor.id,
      action: 'STAFF_ACCOUNT_CREATE',
      entityId: created.id,
    });
    expect(transactionRunner).toHaveBeenCalledTimes(1);
  });

  it('suspends a driver account and its profile atomically after checking active assignments', async () => {
    const now = new Date();
    const actor = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.test',
      fullName: 'Admin',
      role: UserRole.ADMIN,
      mustChangePassword: false,
    };
    const driverProfile = {
      id: '33333333-3333-4333-8333-333333333333',
      version: 4,
    };
    const current = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'driver@example.test',
      passwordHash: 'hash',
      fullName: 'Driver',
      phone: null,
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      tokenVersion: 0,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
      driverProfile,
    };
    const updated = { ...current, status: UserStatus.SUSPENDED, tokenVersion: 1 };
    const transaction = {
      user: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(updated)),
      },
      driverAssignment: { count: jest.fn(() => Promise.resolve(0)) },
      lineHaulTrip: { count: jest.fn(() => Promise.resolve(0)) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new UsersService(prisma, {} as PasswordHasherService).setStatus(
      actor,
      current.id,
      UserStatus.SUSPENDED,
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
    );

    expect(transaction.driverAssignment.count).toHaveBeenCalledTimes(1);
    expect(transaction.driverProfile.updateMany).toHaveBeenCalledWith({
      where: { id: driverProfile.id, version: driverProfile.version },
      data: {
        status: 'SUSPENDED',
        isOnline: false,
        isAvailable: false,
        version: { increment: 1 },
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(UserStatus.SUSPENDED);
  });
});
