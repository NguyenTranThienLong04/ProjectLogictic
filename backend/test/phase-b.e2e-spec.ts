import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriverStatus, ShipmentStatus, UserRole } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import {
  ROUTE_PROVIDER,
  type RouteProvider,
  type RouteRequest,
} from '../src/modules/routing/route-provider.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface CandidateResponse {
  distanceMethod: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK' | 'MIXED';
  distanceNotice: string;
  candidates: Array<{
    id: string;
    estimatedDistanceKm: number;
    distanceMeters: number;
    durationSeconds: number | null;
    metricMode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
  }>;
  exclusions: {
    noOperatingWarehouse: number;
    outsideOperatingArea: number;
    noCurrentLocation: number;
  };
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Operational Realism Phase B location-aware assignment (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  const runId = randomUUID().replaceAll('-', '');
  const password = 'Password@123456';
  const emails = {
    dispatcher: `dispatcher-pb-${runId}@example.com`,
    customer: `customer-pb-${runId}@example.com`,
    near: `near-driver-pb-${runId}@example.com`,
    far: `far-driver-pb-${runId}@example.com`,
    wrong: `wrong-driver-pb-${runId}@example.com`,
    missing: `missing-driver-pb-${runId}@example.com`,
    stale: `stale-driver-pb-${runId}@example.com`,
  };
  const warehouseIds: string[] = [];
  const shipmentIds: string[] = [];
  const driverIds: string[] = [];
  let dispatcherToken = '';
  let customerToken = '';
  let pickupShipmentId = '';
  let deliveryShipmentId = '';
  let nearDriverId = '';
  let farDriverId = '';
  let wrongDriverId = '';
  let missingDriverId = '';
  let providerFailure = false;
  let routeProviderIdentifier = `PHASE_B_ROAD_${runId}`;
  const routeCalculate = jest.fn((routeRequest: RouteRequest) => {
    if (providerFailure) {
      return Promise.reject(new Error('test provider unavailable with secret=must-not-leak'));
    }
    const farDriver = routeRequest.origin.latitude > 10.8;
    return Promise.resolve({
      distanceMeters: farDriver ? 4_000 : 9_000,
      durationSeconds: farDriver ? 420 : 900,
      provider: routeProviderIdentifier,
      calculatedAt: new Date(),
    });
  });
  const routeProvider: RouteProvider = {
    get identifier() {
      return routeProviderIdentifier;
    },
    enabled: true,
    calculate: routeCalculate,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROUTE_PROVIDER)
      .useValue(routeProvider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const cookieParser = (await import('cookie-parser')).default;
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    if (!redis.isAvailable()) {
      throw new Error('Phase B E2E requires the configured local Redis instance');
    }

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const [, customer, nearUser, farUser, wrongUser, missingUser, staleUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: emails.dispatcher,
          fullName: 'Phase B Dispatcher',
          passwordHash,
          role: UserRole.DISPATCHER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.customer,
          fullName: 'Phase B Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      ...Object.entries(emails)
        .filter(([name]) => !['dispatcher', 'customer'].includes(name))
        .map(([name, email]) =>
          prisma.user.create({
            data: {
              email,
              fullName: `Phase B ${name} driver`,
              passwordHash,
              role: UserRole.DRIVER,
            },
          }),
        ),
    ]);

    const [hcmWarehouse, hanoiWarehouse] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `PB-HCM-${runId.slice(0, 10).toUpperCase()}`,
          name: 'Phase B HCM Hub',
          address: '1 Nguyễn Huệ',
          city: 'Hồ Chí Minh',
          latitude: 10.7769,
          longitude: 106.7009,
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `PB-HAN-${runId.slice(0, 10).toUpperCase()}`,
          name: 'Phase B Hanoi Hub',
          address: '1 Tràng Tiền',
          city: 'Hà Nội',
          latitude: 21.0285,
          longitude: 105.8542,
        },
      }),
    ]);
    warehouseIds.push(hcmWarehouse.id, hanoiWarehouse.id);

    const createDriver = (userId: string, code: string, operatingWarehouseId: string) =>
      prisma.driverProfile.create({
        data: {
          userId,
          operatingWarehouseId,
          employeeCode: `PB-${code}-${runId.slice(0, 8).toUpperCase()}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `59-${code}-${runId.slice(0, 4).toUpperCase()}`,
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        },
      });
    const [near, far, wrong, missing, stale] = await Promise.all([
      createDriver(nearUser.id, 'NEAR', hcmWarehouse.id),
      createDriver(farUser.id, 'FAR', hcmWarehouse.id),
      createDriver(wrongUser.id, 'WRONG', hanoiWarehouse.id),
      createDriver(missingUser.id, 'MISS', hcmWarehouse.id),
      createDriver(staleUser.id, 'STALE', hcmWarehouse.id),
    ]);
    driverIds.push(near.id, far.id, wrong.id, missing.id, stale.id);
    nearDriverId = near.id;
    farDriverId = far.id;
    wrongDriverId = wrong.id;
    missingDriverId = missing.id;

    const shipmentData = {
      customerId: customer.id,
      senderSnapshot: { fullName: 'Sender', phone: '0900000001' },
      receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
      pickupSnapshot: {
        streetAddress: '1 Nguyễn Huệ',
        city: 'Thanh pho Ho Chi Minh',
        latitude: 10.7769,
        longitude: 106.7009,
      },
      deliverySnapshot: { streetAddress: '2 Lê Lợi', city: 'Hồ Chí Minh' },
      packageSnapshot: { description: 'Phase B parcel', packageType: 'PARCEL', weightGrams: 500 },
      pricingSnapshot: { totalFee: 30_000 },
      totalFee: 30_000,
      shippingFeeTransaction: { create: { payer: 'SENDER' as const, expectedAmount: 30_000 } },
    };
    const [pickupShipment, deliveryShipment] = await Promise.all([
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-PB-P-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-PB-D-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
          destinationWarehouseId: hcmWarehouse.id,
          currentWarehouseId: hcmWarehouse.id,
        },
      }),
    ]);
    shipmentIds.push(pickupShipment.id, deliveryShipment.id);
    pickupShipmentId = pickupShipment.id;
    deliveryShipmentId = deliveryShipment.id;

    const currentUpdatedAt = new Date().toISOString();
    await Promise.all([
      thisSetLocation(near.id, 10.777, 106.701, currentUpdatedAt),
      thisSetLocation(far.id, 10.9, 106.8, currentUpdatedAt),
      thisSetLocation(wrong.id, 10.7769, 106.7009, currentUpdatedAt),
      thisSetLocation(stale.id, 10.7769, 106.7009, new Date(Date.now() - 20_001).toISOString()),
    ]);

    const login = async (email: string): Promise<string> => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [dispatcherToken, customerToken] = await Promise.all([
      login(emails.dispatcher),
      login(emails.customer),
    ]);

    function thisSetLocation(
      driverId: string,
      latitude: number,
      longitude: number,
      updatedAt: string,
    ) {
      return redis
        .getClient()
        .set(
          `driver:location:${driverId}`,
          JSON.stringify({ driverId, latitude, longitude, updatedAt }),
          'EX',
          60,
        );
    }
  });

  afterAll(async () => {
    if (redis?.isAvailable() && driverIds.length > 0) {
      await redis.getClient().del(driverIds.map((driverId) => `driver:location:${driverId}`));
    }
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: shipmentIds } }] },
    });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.driverProfile.deleteMany({ where: { id: { in: driverIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    await app.close();
  });

  it('enforces RBAC, ranks pickup by road route, and falls back without a fake ETA', async () => {
    routeCalculate.mockClear();
    await request(server)
      .get(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-candidates`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    expect(routeCalculate).not.toHaveBeenCalled();

    await request(server)
      .post('/api/v1/routes')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ origin: [10.7, 106.7], destination: [21, 105.8] })
      .expect(404);

    const response = await request(server)
      .get(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-candidates`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const result = bodyFrom<CandidateResponse>(response).data;
    expect(result.distanceMethod).toBe('ROAD_ROUTE');
    expect(result.distanceNotice).toContain('khoảng cách đường bộ');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([farDriverId, nearDriverId]);
    expect(result.candidates[0]).toMatchObject({
      distanceMeters: 4_000,
      durationSeconds: 420,
      metricMode: 'ROAD_ROUTE',
    });
    expect(result.candidates.map((candidate) => candidate.id)).not.toEqual(
      expect.arrayContaining([wrongDriverId, missingDriverId]),
    );
    expect(result.exclusions.outsideOperatingArea).toBeGreaterThanOrEqual(1);
    expect(result.exclusions.noCurrentLocation).toBeGreaterThanOrEqual(2);
    expect(routeCalculate).toHaveBeenCalledTimes(2);

    const cacheHitResponse = await request(server)
      .get(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-candidates`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<CandidateResponse>(cacheHitResponse).data.candidates).toEqual(
      result.candidates,
    );
    expect(routeCalculate).toHaveBeenCalledTimes(2);

    providerFailure = true;
    routeProviderIdentifier = `PHASE_B_FAIL_${runId}`;
    const fallbackResponse = await request(server)
      .get(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-candidates`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const fallback = bodyFrom<CandidateResponse>(fallbackResponse).data;
    expect(fallback.distanceMethod).toBe('HAVERSINE_FALLBACK');
    expect(fallback.candidates.map((candidate) => candidate.id)).toEqual([
      nearDriverId,
      farDriverId,
    ]);
    expect(fallback.candidates.every((candidate) => candidate.durationSeconds === null)).toBe(true);
    expect(
      fallback.candidates.every((candidate) => candidate.metricMode === 'HAVERSINE_FALLBACK'),
    ).toBe(true);
    providerFailure = false;
    routeProviderIdentifier = `PHASE_B_ROAD_DELIVERY_${runId}`;
  });

  it('ranks delivery candidates by destination warehouse and excludes wrong warehouse', async () => {
    const response = await request(server)
      .get(`/api/v1/dispatcher/shipments/${deliveryShipmentId}/delivery-candidates`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const result = bodyFrom<CandidateResponse>(response).data;
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([farDriverId, nearDriverId]);
    expect(result.distanceMethod).toBe('ROAD_ROUTE');
    expect(result.exclusions.outsideOperatingArea).toBe(1);
    expect(result.exclusions.noCurrentLocation).toBe(2);
  });

  it('rejects wrong-area and missing-GPS assignments without returning 500', async () => {
    await request(server)
      .post(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ driverId: wrongDriverId, clientRequestId: randomUUID() })
      .expect(409);
    await request(server)
      .post(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ driverId: missingDriverId, clientRequestId: randomUUID() })
      .expect(409);
  });

  it('allows only one winner when dispatchers assign the same shipment concurrently', async () => {
    const refreshedAt = new Date().toISOString();
    await Promise.all([
      redis.getClient().set(
        `driver:location:${nearDriverId}`,
        JSON.stringify({
          driverId: nearDriverId,
          latitude: 10.777,
          longitude: 106.701,
          updatedAt: refreshedAt,
        }),
        'EX',
        60,
      ),
      redis.getClient().set(
        `driver:location:${farDriverId}`,
        JSON.stringify({
          driverId: farDriverId,
          latitude: 10.9,
          longitude: 106.8,
          updatedAt: refreshedAt,
        }),
        'EX',
        60,
      ),
    ]);
    const responses = await Promise.all([
      request(server)
        .post(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-assignments`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ driverId: nearDriverId, clientRequestId: randomUUID() }),
      request(server)
        .post(`/api/v1/dispatcher/shipments/${pickupShipmentId}/pickup-assignments`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ driverId: farDriverId, clientRequestId: randomUUID() }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(
      prisma.driverAssignment.count({
        where: { shipmentId: pickupShipmentId, status: 'PENDING' },
      }),
    ).resolves.toBe(1);
  });
});
