import { ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { validate } from 'class-validator';
import { ListDriversDto } from './dto/list-drivers.dto.js';
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
  it('validates optional filter enum and warehouse UUID', async () => {
    expect(
      await validate(
        Object.assign(new ListDriversDto(), {
          capability: 'DELIVERY',
          operatingWarehouseId: driverUserId,
        }),
      ),
    ).toHaveLength(0);
    const errors = await validate(
      Object.assign(new ListDriversDto(), {
        capability: 'INVALID',
        operatingWarehouseId: 'warehouse-code',
      }),
    );
    expect(errors.map((error) => error.property).sort()).toEqual([
      'capability',
      'operatingWarehouseId',
    ]);
  });

  it('creates the profile with its selected active warehouse and existing default capabilities', async () => {
    const warehouse = {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'WH-1',
      name: 'Kho 1',
      city: 'Hà Nội',
    };
    const created = {
      ...profile(DriverStatus.OFFLINE),
      capabilities: ['PICKUP', 'DELIVERY'],
      operatingWarehouseId: warehouse.id,
      operatingWarehouse: warehouse,
    };
    const transaction = {
      user: { findUnique: jest.fn(() => Promise.resolve(created.user)) },
      warehouse: { findFirst: jest.fn(() => Promise.resolve(warehouse)) },
      driverProfile: { create: jest.fn(() => Promise.resolve(created)) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const result = await new DriversService(prisma).create(
      actor,
      {
        userId: driverUserId,
        operatingWarehouseId: warehouse.id,
        employeeCode: 'drv-001',
        vehicleType: 'Motorbike',
        vehiclePlate: '59A1-12345',
      },
      {},
    );
    expect(result.operatingWarehouse).toEqual(warehouse);
    expect(transaction.driverProfile.create.mock.calls).toMatchObject([
      [
        {
          data: {
            operatingWarehouseId: warehouse.id,
            capabilities: ['PICKUP', 'DELIVERY'],
            employeeCode: 'DRV-001',
            status: 'OFFLINE',
          },
        },
      ],
    ]);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('updates an idle driver operating warehouse with optimistic version and audit', async () => {
    const current = { ...profile(DriverStatus.OFFLINE), operatingWarehouseId: driverUserId };
    const warehouse = {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'WH-2',
      name: 'Kho 2',
      city: 'Đà Nẵng',
    };
    const updated = {
      ...current,
      operatingWarehouseId: warehouse.id,
      operatingWarehouse: warehouse,
      version: 1,
    };
    const transaction = {
      driverProfile: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(updated)),
      },
      driverAssignment: { count: jest.fn(() => Promise.resolve(0)) },
      warehouse: { findFirst: jest.fn(() => Promise.resolve(warehouse)) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const result = await new DriversService(prisma).update(
      actor,
      current.id,
      { operatingWarehouseId: warehouse.id },
      {},
    );
    expect(result.operatingWarehouse).toEqual(warehouse);
    expect(transaction.driverProfile.updateMany).toHaveBeenCalledWith({
      where: { id: current.id, version: 0 },
      data: { operatingWarehouseId: warehouse.id, version: { increment: 1 } },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('combines server-side search, capability, warehouse and status before pagination/count', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const count = jest.fn(() => Promise.resolve(23));
    const prisma = { driverProfile: { findMany, count } } as unknown as PrismaService;
    const result = await new DriversService(prisma).list({
      search: '  driver  ',
      capability: 'PICKUP',
      operatingWarehouseId: driverUserId,
      status: DriverStatus.AVAILABLE,
      page: 2,
      limit: 20,
    });
    const where = {
      capabilities: { has: 'PICKUP' },
      operatingWarehouseId: driverUserId,
      status: DriverStatus.AVAILABLE,
      OR: [
        { employeeCode: { contains: 'driver', mode: 'insensitive' } },
        { vehiclePlate: { contains: 'driver', mode: 'insensitive' } },
        { user: { fullName: { contains: 'driver', mode: 'insensitive' } } },
        { user: { email: { contains: 'driver', mode: 'insensitive' } } },
      ],
    };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 20, take: 20 }));
    expect(count).toHaveBeenCalledWith({ where });
    expect(result).toMatchObject({ total: 23, totalPages: 2, page: 2 });
  });

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
