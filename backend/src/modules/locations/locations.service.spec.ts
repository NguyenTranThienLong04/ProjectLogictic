import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  DriverCapability,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  LineHaulTripStatus,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { RedisService } from '../../redis/redis.service.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import { LocationsService } from './locations.service.js';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  role: UserRole.DRIVER,
  email: 'driver@example.test',
  fullName: 'Driver One',
  mustChangePassword: false,
};
const driverId = '22222222-2222-4222-8222-222222222222';
const shipmentId = '33333333-3333-4333-8333-333333333333';
const tripId = '44444444-4444-4444-8444-444444444444';

function service(
  prisma: PrismaService,
  redis: RedisService,
  gateway: NotificationsGateway,
): LocationsService {
  return new LocationsService(prisma, redis, gateway);
}

describe('LocationsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stores the driver location with the canonical TTL and broadcasts to only out-for-delivery shipments', async () => {
    const set = jest.fn(() => Promise.resolve('OK'));
    const emitDriverLocationUpdated = jest.fn();
    const findMany = jest.fn(() => Promise.resolve([{ shipmentId }]));
    const prisma = {
      driverProfile: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: driverId,
            status: DriverStatus.BUSY,
            user: { status: UserStatus.ACTIVE },
          }),
        ),
      },
      driverAssignment: {
        findMany,
      },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;
    const gateway = { emitDriverLocationUpdated } as unknown as NotificationsGateway;

    const location = await service(prisma, redis, gateway).updateMine(actor, {
      latitude: 10.7769,
      longitude: 106.7009,
    });

    expect(set).toHaveBeenCalledWith(
      `driver:location:${driverId}`,
      JSON.stringify(location),
      'EX',
      20,
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        driverId,
        type: DriverAssignmentType.DELIVERY,
        status: {
          in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED],
        },
        shipment: { status: ShipmentStatus.OUT_FOR_DELIVERY },
      },
      select: { shipmentId: true },
    });
    expect(emitDriverLocationUpdated).toHaveBeenCalledWith(location, [shipmentId]);
  });

  it('does not expose a customer location outside OUT_FOR_DELIVERY', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = { shipment: { findFirst } } as unknown as PrismaService;
    const redis = {} as RedisService;
    const gateway = {} as NotificationsGateway;

    await expect(
      service(prisma, redis, gateway).getCustomerShipmentLocation(actor.id, shipmentId),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: shipmentId,
        customerId: actor.id,
        status: ShipmentStatus.OUT_FOR_DELIVERY,
      },
      select: { id: true },
    });
  });

  it('reads only the authenticated driver own current Redis location', async () => {
    const location = {
      driverId,
      latitude: 10.7769,
      longitude: 106.7009,
      updatedAt: new Date().toISOString(),
    };
    const get = jest.fn(() => Promise.resolve(JSON.stringify(location)));
    const findUnique = jest.fn(() => Promise.resolve({ id: driverId }));
    const prisma = { driverProfile: { findUnique } } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ get })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).getMine(actor.id),
    ).resolves.toEqual(location);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: actor.id }, select: { id: true } });
    expect(get).toHaveBeenCalledWith(`driver:location:${driverId}`);
  });

  it('returns no current location when Redis has no value', async () => {
    const get = jest.fn(() => Promise.resolve(null));
    const prisma = {
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: driverId })) },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ get })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).getMine(actor.id),
    ).resolves.toBeNull();
  });

  it('treats a location older than the canonical TTL as stale even if the Redis key remains', async () => {
    const location = {
      driverId,
      latitude: 10.7769,
      longitude: 106.7009,
      updatedAt: new Date(Date.now() - 20_001).toISOString(),
    };
    const get = jest.fn(() => Promise.resolve(JSON.stringify(location)));
    const prisma = {
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: driverId })) },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ get })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).getMine(actor.id),
    ).resolves.toBeNull();
  });

  it('degrades an unavailable Redis read to no current location instead of throwing 500', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const get = jest.fn(() => Promise.reject(new Error('Connection is closed')));
    const prisma = {
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: driverId })) },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ get })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).getMine(actor.id),
    ).resolves.toBeNull();
  });

  it('returns no operational locations when Redis is unavailable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mget = jest.fn(() => Promise.reject(new Error('Connection is closed')));
    const prisma = {
      driverProfile: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: driverId,
              employeeCode: 'DRV-001',
              vehiclePlate: '59A1-001.01',
              user: { fullName: 'Driver One' },
            },
          ]),
        ),
      },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ mget })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).listOperationalLocations(),
    ).resolves.toEqual([]);
  });

  it('reports Redis write failure as service unavailable and does not broadcast', async () => {
    const set = jest.fn(() => Promise.reject(new Error('Connection is closed')));
    const emitDriverLocationUpdated = jest.fn();
    const findMany = jest.fn();
    const prisma = {
      driverProfile: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: driverId,
            status: DriverStatus.BUSY,
            user: { status: UserStatus.ACTIVE },
          }),
        ),
      },
      driverAssignment: { findMany },
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;
    const gateway = { emitDriverLocationUpdated } as unknown as NotificationsGateway;

    await expect(
      service(prisma, redis, gateway).updateMine(actor, {
        latitude: 10.7769,
        longitude: 106.7009,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(findMany).not.toHaveBeenCalled();
    expect(emitDriverLocationUpdated).not.toHaveBeenCalled();
  });

  it('stores and broadcasts GPS only for the authenticated driver owned in-transit trip', async () => {
    const set = jest.fn(() => Promise.resolve('OK'));
    const emitLineHaulLocationUpdated = jest.fn();
    const transaction = lineHaulTransaction();
    const prisma = {
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;
    const gateway = { emitLineHaulLocationUpdated } as unknown as NotificationsGateway;

    const location = await service(prisma, redis, gateway).updateMyLineHaulTrip(actor, tripId, {
      latitude: 10.7769,
      longitude: 106.7009,
    });

    expect(location).toMatchObject({ tripId, latitude: 10.7769, longitude: 106.7009 });
    expect(set).toHaveBeenCalledWith(
      `linehaul:trip:location:${tripId}`,
      expect.stringContaining(`"driverId":"${driverId}"`),
      'EX',
      20,
    );
    expect(emitLineHaulLocationUpdated).toHaveBeenCalledWith(location);
  });

  it('rejects a different driver and a driver without LINE_HAUL capability', async () => {
    const wrongOwner = lineHaulTransaction({ profileId: '55555555-5555-4555-8555-555555555555' });
    const noCapability = lineHaulTransaction({ capabilities: [DriverCapability.PICKUP] });
    const createPrisma = (transaction: ReturnType<typeof lineHaulTransaction>) =>
      ({
        $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(transaction)),
      }) as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ set: jest.fn() })) } as unknown as RedisService;

    await expect(
      service(createPrisma(wrongOwner), redis, {} as NotificationsGateway).updateMyLineHaulTrip(
        actor,
        tripId,
        { latitude: 10, longitude: 106 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service(createPrisma(noCapability), redis, {} as NotificationsGateway).updateMyLineHaulTrip(
        actor,
        tripId,
        { latitude: 10, longitude: 106 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a suspended line-haul driver profile', async () => {
    const transaction = lineHaulTransaction({ driverStatus: DriverStatus.SUSPENDED });
    const prisma = {
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const set = jest.fn();
    const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {} as NotificationsGateway).updateMyLineHaulTrip(actor, tripId, {
        latitude: 10,
        longitude: 106,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([LineHaulTripStatus.PLANNED, LineHaulTripStatus.READY, LineHaulTripStatus.ARRIVED])(
    'rejects line-haul GPS while trip status is %s',
    async (status) => {
      const transaction = lineHaulTransaction({ status });
      const prisma = {
        $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(transaction)),
      } as unknown as PrismaService;
      const set = jest.fn();
      const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;

      await expect(
        service(prisma, redis, {} as NotificationsGateway).updateMyLineHaulTrip(actor, tripId, {
          latitude: 10,
          longitude: 106,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(set).not.toHaveBeenCalled();
    },
  );

  it('does not broadcast line-haul GPS when Redis write fails', async () => {
    const set = jest.fn(() => Promise.reject(new Error('Connection is closed')));
    const emitLineHaulLocationUpdated = jest.fn();
    const transaction = lineHaulTransaction();
    const prisma = {
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const redis = { getClient: jest.fn(() => ({ set })) } as unknown as RedisService;

    await expect(
      service(prisma, redis, {
        emitLineHaulLocationUpdated,
      } as unknown as NotificationsGateway).updateMyLineHaulTrip(actor, tripId, {
        latitude: 10,
        longitude: 106,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(emitLineHaulLocationUpdated).not.toHaveBeenCalled();
  });

  it('maps stale and Redis-unavailable line-haul reads to explicit non-current states', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const trip = lineHaulMapRecord();
    const stale = JSON.stringify({
      tripId,
      driverId,
      latitude: 10,
      longitude: 106,
      capturedAt: new Date(Date.now() - 20_001).toISOString(),
    });
    const findMany = jest.fn(() => Promise.resolve([trip]));
    const prisma = { lineHaulTrip: { findMany } } as unknown as PrismaService;
    const redis = {
      getClient: jest
        .fn()
        .mockReturnValueOnce({ mget: jest.fn(() => Promise.resolve([stale])) })
        .mockReturnValueOnce({ mget: jest.fn(() => Promise.reject(new Error('closed'))) }),
    } as unknown as RedisService;
    const locations = service(prisma, redis, {} as NotificationsGateway);

    await expect(
      locations.listActiveLineHaulLocations({ ...actor, role: UserRole.DISPATCHER }),
    ).resolves.toMatchObject([
      {
        locationState: 'STALE',
        location: null,
        route: null,
        deviation: {
          state: 'UNKNOWN',
          distanceFromRouteMeters: null,
          detectedAt: null,
        },
      },
    ]);
    await expect(
      locations.listActiveLineHaulLocations({ ...actor, role: UserRole.ADMIN }),
    ).resolves.toMatchObject([
      {
        locationState: 'UNAVAILABLE',
        location: null,
        route: null,
        deviation: {
          state: 'UNKNOWN',
          distanceFromRouteMeters: null,
          detectedAt: null,
        },
      },
    ]);
  });
});

function lineHaulTransaction(overrides?: {
  profileId?: string;
  capabilities?: DriverCapability[];
  driverStatus?: DriverStatus;
  status?: LineHaulTripStatus;
}) {
  return {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    lineHaulTrip: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: tripId,
          driverId,
          status: overrides?.status ?? LineHaulTripStatus.IN_TRANSIT,
        }),
      ),
    },
    driverProfile: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: overrides?.profileId ?? driverId,
          status: overrides?.driverStatus ?? DriverStatus.BUSY,
          capabilities: overrides?.capabilities ?? [DriverCapability.LINE_HAUL],
          user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        }),
      ),
    },
  };
}

function lineHaulMapRecord() {
  return {
    id: tripId,
    tripCode: 'LHT-TEST',
    status: LineHaulTripStatus.IN_TRANSIT,
    driverId,
    departedAt: new Date(),
    originWarehouseId: '66666666-6666-4666-8666-666666666666',
    destinationWarehouseId: '77777777-7777-4777-8777-777777777777',
    originWarehouse: {
      id: '66666666-6666-4666-8666-666666666666',
      code: 'ORG',
      name: 'Origin',
      address: 'Origin address',
      latitude: 10,
      longitude: 106,
    },
    destinationWarehouse: {
      id: '77777777-7777-4777-8777-777777777777',
      code: 'DST',
      name: 'Destination',
      address: 'Destination address',
      latitude: 11,
      longitude: 107,
    },
    driver: { id: driverId, employeeCode: 'DRV-LH', user: { fullName: 'Driver One' } },
    vehicle: {
      id: '88888888-8888-4888-8888-888888888888',
      vehicleCode: 'TRUCK-1',
      licensePlate: '51C-12345',
      vehicleType: 'TRUCK',
    },
  };
}
