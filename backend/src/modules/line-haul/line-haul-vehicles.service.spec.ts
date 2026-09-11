import { ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { LineHaulVehicleStatus, Prisma, UserRole } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { LineHaulVehiclesService } from './line-haul-vehicles.service.js';

const actor: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  fullName: 'Admin',
  role: UserRole.ADMIN,
  mustChangePassword: false,
};

const vehicle = {
  id: '22222222-2222-4222-8222-222222222222',
  vehicleCode: 'TRUCK-001',
  licensePlate: '51C-12345',
  vehicleType: 'Truck',
  capacityWeightGrams: 5_000_000,
  status: LineHaulVehicleStatus.AVAILABLE,
  version: 0,
  createdAt: new Date('2026-09-03T00:00:00.000Z'),
  updatedAt: new Date('2026-09-03T00:00:00.000Z'),
};

describe('LineHaulVehiclesService', () => {
  it('creates a normalized available vehicle and audit record', async () => {
    const transaction = {
      lineHaulVehicle: { create: jest.fn(() => Promise.resolve(vehicle)) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new LineHaulVehiclesService(prisma).create(
      actor,
      {
        vehicleCode: ' truck-001 ',
        licensePlate: '51c-12345',
        vehicleType: 'Truck',
        capacityWeightGrams: 5_000_000,
      },
      {},
    );

    expect(result).toMatchObject({
      vehicleCode: 'TRUCK-001',
      licensePlate: '51C-12345',
      status: LineHaulVehicleStatus.AVAILABLE,
    });
    const createCalls = transaction.lineHaulVehicle.create.mock.calls as unknown as Array<
      [{ data: { vehicleCode: string; licensePlate: string } }]
    >;
    expect(createCalls[0][0].data).toMatchObject({
      vehicleCode: 'TRUCK-001',
      licensePlate: '51C-12345',
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns a stable conflict for duplicate vehicle code or license plate', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.9.1',
      meta: { target: ['vehicleCode'] },
    });
    const prisma = {
      $transaction: jest.fn(() => Promise.reject(duplicate)),
    } as unknown as PrismaService;

    try {
      await new LineHaulVehiclesService(prisma).create(
        actor,
        {
          vehicleCode: 'TRUCK-001',
          licensePlate: '51C-99999',
          vehicleType: 'Truck',
          capacityWeightGrams: 5_000_000,
        },
        {},
      );
      throw new Error('Expected duplicate vehicle identifier to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LINE_HAUL_VEHICLE_UNIQUE_CONFLICT',
      });
    }
    await expect(
      new LineHaulVehiclesService(prisma).create(
        actor,
        {
          vehicleCode: 'TRUCK-002',
          licensePlate: '51C-12345',
          vehicleType: 'Truck',
          capacityWeightGrams: 5_000_000,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates capacity when it still contains the active planned manifest and audits once', async () => {
    const activeTrip = {
      id: '33333333-3333-4333-8333-333333333333',
      transferAssignments: [
        {
          isActive: true,
          warehouseTransfer: { shipment: { packageSnapshot: { weightGrams: 3_000_000 } } },
        },
      ],
    };
    const updatedVehicle = { ...vehicle, capacityWeightGrams: 4_000_000, version: 1 };
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      lineHaulVehicle: {
        findUnique: jest.fn(() => Promise.resolve(vehicle)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(updatedVehicle)),
      },
      lineHaulTrip: { findMany: jest.fn(() => Promise.resolve([activeTrip])) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      lineHaulTrip: { findMany: jest.fn(() => Promise.resolve([{ id: activeTrip.id }])) },
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new LineHaulVehiclesService(prisma).updateCapacity(
      actor,
      vehicle.id,
      { capacityWeightGrams: 4_000_000 },
      {},
    );

    expect(result.capacityWeightGrams).toBe(4_000_000);
    expect(transaction.lineHaulVehicle.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reducing capacity below an active manifest without updating or auditing', async () => {
    const activeTrip = {
      id: '33333333-3333-4333-8333-333333333333',
      transferAssignments: [
        {
          isActive: true,
          warehouseTransfer: { shipment: { packageSnapshot: { weightGrams: 3_000_000 } } },
        },
      ],
    };
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      lineHaulVehicle: {
        findUnique: jest.fn(() => Promise.resolve(vehicle)),
        updateMany: jest.fn(),
      },
      lineHaulTrip: { findMany: jest.fn(() => Promise.resolve([activeTrip])) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      lineHaulTrip: { findMany: jest.fn(() => Promise.resolve([{ id: activeTrip.id }])) },
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new LineHaulVehiclesService(prisma).updateCapacity(
        actor,
        vehicle.id,
        { capacityWeightGrams: 2_999_999 },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED' } });
    expect(transaction.lineHaulVehicle.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});
