import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  ShipmentStatus,
  UserRole,
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import {
  ROUTE_PROVIDER,
  type RouteProvider,
  type RouteRequest,
} from '../src/modules/routing/route-provider.js';

jest.setTimeout(180_000);

interface ApiEnvelope<T> {
  data: T;
}

interface LocationPayload {
  tripId: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
}

interface MapTrip {
  tripId: string;
  locationState: 'CURRENT' | 'MISSING' | 'STALE' | 'UNAVAILABLE' | 'DISABLED';
  location: LocationPayload | null;
  lastCapturedAt: string | null;
}

interface TripRoutePayload {
  plannedRoute: RouteVersionPayload | null;
  currentRoute: RouteVersionPayload | null;
  routeHistory: RouteVersionPayload[];
  remainingRoute: {
    distanceMeters: number;
    durationSeconds: number | null;
    mode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
    provider: string;
  } | null;
}

interface RouteVersionPayload {
  id: string;
  version: number;
  type: 'PLANNED' | 'REROUTE';
  geometry: { points: Array<{ latitude: number; longitude: number }> } | null;
}

interface DeviationPayload {
  tripId: string;
  state: 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN';
  distanceFromRouteMeters: number | null;
  detectedAt: string;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase G3A line-haul GPS and realtime map (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  const sockets: Socket[] = [];
  const password = 'Password@123456';
  const runId = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const suffix = runId.toLowerCase();
  const emails = {
    admin: `g3a-admin-${suffix}@example.com`,
    dispatcher: `g3a-dispatcher-${suffix}@example.com`,
    customer: `g3a-customer-${suffix}@example.com`,
    driver: `g3a-driver-${suffix}@example.com`,
    otherDriver: `g3a-other-driver-${suffix}@example.com`,
    noCapabilityDriver: `g3a-no-cap-${suffix}@example.com`,
    originStaff: `g3a-origin-${suffix}@example.com`,
    destinationStaff: `g3a-destination-${suffix}@example.com`,
    wrongStaff: `g3a-wrong-${suffix}@example.com`,
  };
  const tokens = new Map<string, string>();
  let dispatcherId = '';
  let customerId = '';
  let driverId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let wrongWarehouseId = '';
  let vehicleId = '';
  let shipmentId = '';
  let transferId = '';
  let tripId = '';
  let failGeometryCalculation = false;
  let geometryGate: Promise<void> | null = null;
  let notifyGeometryGateEntered: (() => void) | null = null;
  const routeProvider: RouteProvider = {
    identifier: `PHASE_G3A_ROAD_${runId}`,
    enabled: true,
    calculate: jest.fn(async (routeRequest: RouteRequest) => {
      if (routeRequest.includeGeometry && geometryGate) {
        notifyGeometryGateEntered?.();
        await geometryGate;
      }
      if (routeRequest.includeGeometry && failGeometryCalculation) {
        throw new Error('simulated route provider timeout');
      }
      const plannedRoute = routeRequest.origin.latitude < 10.79;
      return {
        distanceMeters: routeRequest.origin.latitude > 10.79 ? 950_000 : 965_000,
        durationSeconds: routeRequest.origin.latitude > 10.79 ? 54_000 : 57_600,
        provider: `PHASE_G3A_ROAD_${runId}`,
        calculatedAt: new Date(),
        ...(routeRequest.includeGeometry
          ? {
              geometry: {
                points: plannedRoute
                  ? [
                      routeRequest.origin,
                      { latitude: 10.8, longitude: 106.72 },
                      { latitude: 10.9, longitude: 106.82 },
                      routeRequest.destination,
                    ]
                  : [routeRequest.origin, routeRequest.destination],
              },
            }
          : {}),
      };
    }),
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
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const users = await Promise.all(
      Object.entries(emails).map(([key, email]) =>
        prisma.user.create({
          data: {
            email,
            fullName: `Phase G3A ${key}`,
            passwordHash,
            role:
              key === 'admin'
                ? UserRole.ADMIN
                : key === 'dispatcher'
                  ? UserRole.DISPATCHER
                  : key === 'customer'
                    ? UserRole.CUSTOMER
                    : key.endsWith('Staff')
                      ? UserRole.WAREHOUSE_STAFF
                      : UserRole.DRIVER,
          },
        }),
      ),
    );
    const usersByEmail = new Map(users.map((user) => [user.email, user]));
    dispatcherId = usersByEmail.get(emails.dispatcher)!.id;
    customerId = usersByEmail.get(emails.customer)!.id;

    const warehouses = await Promise.all(
      [
        ['ORG', 'Origin Hub', 'Ho Chi Minh City', 10.7769, 106.7009],
        ['DST', 'Destination Hub', 'Da Nang', 16.0544, 108.2022],
        ['WRONG', 'Unrelated Hub', 'Ha Noi', 21.0278, 105.8342],
      ].map(([code, name, city, latitude, longitude]) =>
        prisma.warehouse.create({
          data: {
            code: `G3A-${code}-${runId}`,
            name: `Phase G3A ${name}`,
            address: `${name} address`,
            city: String(city),
            latitude: Number(latitude),
            longitude: Number(longitude),
          },
        }),
      ),
    );
    [originWarehouseId, destinationWarehouseId, wrongWarehouseId] = warehouses.map(
      (warehouse) => warehouse.id,
    );

    await Promise.all([
      prisma.warehouseStaffProfile.create({
        data: {
          userId: usersByEmail.get(emails.originStaff)!.id,
          warehouseId: originWarehouseId,
          staffCode: `G3A-O-${runId}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: usersByEmail.get(emails.destinationStaff)!.id,
          warehouseId: destinationWarehouseId,
          staffCode: `G3A-D-${runId}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: usersByEmail.get(emails.wrongStaff)!.id,
          warehouseId: wrongWarehouseId,
          staffCode: `G3A-W-${runId}`,
        },
      }),
    ]);

    const [driver] = await Promise.all([
      prisma.driverProfile.create({
        data: {
          userId: usersByEmail.get(emails.driver)!.id,
          operatingWarehouseId: originWarehouseId,
          employeeCode: `G3A-LH-${runId}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `G3A-LH-${runId}`,
          capabilities: [DriverCapability.LINE_HAUL],
          status: DriverStatus.BUSY,
          isOnline: true,
        },
      }),
      prisma.driverProfile.create({
        data: {
          userId: usersByEmail.get(emails.otherDriver)!.id,
          operatingWarehouseId: originWarehouseId,
          employeeCode: `G3A-OTHER-${runId}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `G3A-O-${runId}`,
          capabilities: [DriverCapability.LINE_HAUL],
          status: DriverStatus.OFFLINE,
        },
      }),
    ]);
    driverId = driver.id;
    await prisma.driverProfile.create({
      data: {
        userId: usersByEmail.get(emails.noCapabilityDriver)!.id,
        operatingWarehouseId: originWarehouseId,
        employeeCode: `G3A-NO-CAP-${runId}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `G3A-N-${runId}`,
        capabilities: [DriverCapability.PICKUP],
        status: DriverStatus.OFFLINE,
      },
    });

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      tokens.set(email, bodyFrom<{ accessToken: string }>(response).data.accessToken);
    };
    await Promise.all(Object.values(emails).map(login));

    const vehicleResponse = await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', bearer(emails.admin))
      .send({
        vehicleCode: `G3AV-${runId}`,
        licensePlate: `51C-${runId.slice(0, 5)}`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: 8_000_000,
      })
      .expect(201);
    vehicleId = bodyFrom<{ id: string }>(vehicleResponse).data.id;

    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-G3A-${runId}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: 'G3A Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'G3A Receiver', phone: '0900000002' },
        pickupSnapshot: { city: 'Ho Chi Minh City', latitude: 10.7769, longitude: 106.7009 },
        deliverySnapshot: { city: 'Da Nang' },
        packageSnapshot: { description: 'G3A package', packageType: 'PARCEL', weightGrams: 500 },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId,
        destinationWarehouseId,
        currentWarehouseId: originWarehouseId,
        pickedUpAt: new Date(),
      },
    });
    shipmentId = shipment.id;
    const transfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `TRF-G3A-${runId}`,
        shipmentId,
        fromWarehouseId: originWarehouseId,
        toWarehouseId: destinationWarehouseId,
        status: WarehouseTransferStatus.PENDING,
        clientRequestId: randomUUID(),
        createdById: dispatcherId,
      },
    });
    transferId = transfer.id;

    const tripResponse = await request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', bearer(emails.dispatcher))
      .send({
        originWarehouseId,
        destinationWarehouseId,
        driverId,
        vehicleId,
        clientRequestId: randomUUID(),
      })
      .expect(201);
    tripId = bodyFrom<{ id: string }>(tripResponse).data.id;
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/schedule`)
      .set('Authorization', bearer(emails.dispatcher))
      .send({
        expectedVersion: 0,
        scheduledStartAt: '2026-10-20T03:00:00.000Z',
        scheduledEndAt: '2026-10-20T05:00:00.000Z',
      })
      .expect(200);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (tripId) await redis.getClient().del(`linehaul:trip:location:${tripId}`);
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId } });
    await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId } });
    await prisma.lineHaulTrip.updateMany({ where: { id: tripId }, data: { currentRouteId: null } });
    await prisma.lineHaulTripRoute.deleteMany({ where: { tripId } });
    await prisma.lineHaulTrip.deleteMany({ where: { id: tripId } });
    await prisma.warehouseTransfer.deleteMany({ where: { id: transferId } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.lineHaulVehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('rejects unauthorized and pre-departure GPS before enabling the context at dispatch', async () => {
    await request(server)
      .get('/api/v1/line-haul/locations')
      .set('Authorization', bearer(emails.customer))
      .expect(403);
    await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}`)
      .set('Authorization', bearer(emails.customer))
      .expect(403);
    await postLocation(emails.driver, { latitude: 10.77, longitude: 106.7 }).expect(403);
    await postLocation(emails.otherDriver, { latitude: 10.77, longitude: 106.7 }).expect(403);
    await postLocation(emails.noCapabilityDriver, { latitude: 10.77, longitude: 106.7 }).expect(
      403,
    );

    const preDispatchSocket = await connect(bearerToken(emails.dispatcher));
    await expect(subscribe(preDispatchSocket, tripId)).resolves.toEqual({ subscribed: false });

    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/transfers`)
      .set('Authorization', bearer(emails.dispatcher))
      .send({ transferId })
      .expect(200);
    const readyResponse = await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/prepare`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    const plannedRoute = bodyFrom<TripRoutePayload>(readyResponse).data.plannedRoute;
    expect(plannedRoute).toMatchObject({
      version: 1,
      type: 'PLANNED',
    });
    expect(plannedRoute?.geometry?.points.length).toBeGreaterThanOrEqual(2);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/prepare`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    await expect(prisma.lineHaulTripRoute.count({ where: { tripId } })).resolves.toBe(1);
    await postLocation(emails.driver, { latitude: 10.77, longitude: 106.7 }).expect(403);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/dispatch`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    await expect(prisma.lineHaulTripRoute.count({ where: { tripId } })).resolves.toBe(1);
  });

  it('moves A to B through real Redis and Socket.IO with exact operational scope', async () => {
    const [dispatcher, admin, origin, destination, wrong, customer, otherDriver] =
      await Promise.all([
        connect(bearerToken(emails.dispatcher)),
        connect(bearerToken(emails.admin)),
        connect(bearerToken(emails.originStaff)),
        connect(bearerToken(emails.destinationStaff)),
        connect(bearerToken(emails.wrongStaff)),
        connect(bearerToken(emails.customer)),
        connect(bearerToken(emails.otherDriver)),
      ]);
    await expect(subscribe(dispatcher, tripId)).resolves.toEqual({ subscribed: true });
    await expect(subscribe(admin, tripId)).resolves.toEqual({ subscribed: true });
    await expect(subscribe(origin, tripId)).resolves.toEqual({ subscribed: true });
    await expect(subscribe(destination, tripId)).resolves.toEqual({ subscribed: true });
    await expect(subscribe(wrong, tripId)).resolves.toEqual({ subscribed: false });
    await expect(subscribe(customer, tripId)).resolves.toEqual({ subscribed: false });
    await expect(subscribe(otherDriver, tripId)).resolves.toEqual({ subscribed: false });

    const pointA = { latitude: 10.8, longitude: 106.72 };
    const aEvents = [dispatcher, admin, origin, destination].map(waitForLocation);
    const responseA = await postLocation(emails.driver, pointA).expect(200);
    const locationA = bodyFrom<LocationPayload>(responseA).data;
    expect(locationA).toMatchObject({ tripId, ...pointA });
    expect(locationA).not.toHaveProperty('driverId');
    await expect(Promise.all(aEvents)).resolves.toEqual([
      locationA,
      locationA,
      locationA,
      locationA,
    ]);

    const redisKey = `linehaul:trip:location:${tripId}`;
    const [stored, ttl] = await Promise.all([
      redis.getClient().get(redisKey),
      redis.getClient().ttl(redisKey),
    ]);
    expect(JSON.parse(stored!)).toMatchObject({ tripId, driverId, ...pointA });
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(20);

    const tripDetail = await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    expect(bodyFrom<TripRoutePayload>(tripDetail).data.remainingRoute).toMatchObject({
      distanceMeters: 950_000,
      durationSeconds: 54_000,
      mode: 'ROAD_ROUTE',
      provider: `PHASE_G3A_ROAD_${runId}`,
    });
    const currentRoute = bodyFrom<TripRoutePayload>(tripDetail).data.currentRoute;
    expect(currentRoute).toMatchObject({
      version: 1,
      type: 'PLANNED',
    });
    expect(currentRoute?.geometry?.points.length).toBeGreaterThanOrEqual(2);

    for (const email of [
      emails.dispatcher,
      emails.admin,
      emails.originStaff,
      emails.destinationStaff,
    ]) {
      const map = await request(server)
        .get('/api/v1/line-haul/locations')
        .set('Authorization', bearer(email))
        .expect(200);
      expect(bodyFrom<MapTrip[]>(map).data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tripId, locationState: 'CURRENT', location: locationA }),
        ]),
      );
    }
    const wrongMap = await request(server)
      .get('/api/v1/line-haul/locations')
      .set('Authorization', bearer(emails.wrongStaff))
      .expect(200);
    expect(bodyFrom<MapTrip[]>(wrongMap).data.some((trip) => trip.tripId === tripId)).toBe(false);
    await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}/location`)
      .set('Authorization', bearer(emails.customer))
      .expect(403);
    await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}/location`)
      .set('Authorization', bearer(emails.wrongStaff))
      .expect(403);

    const pointB = { latitude: 10.9, longitude: 106.82 };
    const bEvent = waitForLocation(dispatcher);
    const responseB = await postLocation(emails.driver, pointB).expect(200);
    const locationB = bodyFrom<LocationPayload>(responseB).data;
    await expect(bEvent).resolves.toEqual(locationB);
    expect(locationB).toMatchObject({ tripId, ...pointB });

    const staleCapturedAt = new Date(Date.now() - 20_001).toISOString();
    await redis
      .getClient()
      .set(
        redisKey,
        JSON.stringify({ tripId, driverId, ...pointB, capturedAt: staleCapturedAt }),
        'EX',
        120,
      );
    const staleMap = await request(server)
      .get('/api/v1/line-haul/locations')
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    expect(bodyFrom<MapTrip[]>(staleMap).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tripId,
          locationState: 'STALE',
          location: null,
          lastCapturedAt: staleCapturedAt,
        }),
      ]),
    );

    const mget = jest
      .spyOn(redis.getClient(), 'mget')
      .mockRejectedValueOnce(new Error('simulated Redis read failure'));
    const unavailableMap = await request(server)
      .get('/api/v1/line-haul/locations')
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    mget.mockRestore();
    expect(bodyFrom<MapTrip[]>(unavailableMap).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tripId, locationState: 'UNAVAILABLE', location: null }),
      ]),
    );
  });

  it('detects deviation, reroutes with append-only versions, and resolves concurrent commands', async () => {
    const dispatcher = await connect(bearerToken(emails.dispatcher));
    await expect(subscribe(dispatcher, tripId)).resolves.toEqual({ subscribed: true });

    const farPoint = { latitude: 10.8, longitude: 107.5 };
    await postLocation(emails.driver, farPoint).expect(200);
    await postLocation(emails.driver, farPoint).expect(200);
    const deviationEvent = waitForDeviation(dispatcher, 'DEVIATED');
    await postLocation(emails.driver, farPoint).expect(200);
    const deviated = await deviationEvent;
    expect(deviated).toMatchObject({
      tripId,
      state: 'DEVIATED',
    });
    expect(typeof deviated.distanceFromRouteMeters).toBe('number');

    for (const email of [emails.customer, emails.originStaff, emails.driver]) {
      await request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
        .set('Authorization', bearer(email))
        .expect(403);
    }

    const routeUpdated = waitForRouteUpdate(dispatcher);
    const rerouted = await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    await expect(routeUpdated).resolves.toMatchObject({ tripId, routeVersion: 2 });
    const reroutedTrip = bodyFrom<TripRoutePayload>(rerouted).data;
    expect(reroutedTrip.currentRoute).toMatchObject({ version: 2, type: 'REROUTE' });
    expect(reroutedTrip.routeHistory.map(({ version, type }) => ({ version, type }))).toEqual([
      { version: 1, type: 'PLANNED' },
      { version: 2, type: 'REROUTE' },
    ]);
    expect(reroutedTrip.plannedRoute).toMatchObject({ version: 1, type: 'PLANNED' });

    const backOnRoute = waitForDeviation(dispatcher, 'ON_ROUTE');
    await postLocation(emails.driver, farPoint).expect(200);
    await expect(backOnRoute).resolves.toMatchObject({
      tripId,
      state: 'ON_ROUTE',
      distanceFromRouteMeters: 0,
    });

    const concurrentPoint = { latitude: 10.81, longitude: 107.51 };
    await postLocation(emails.driver, concurrentPoint).expect(200);
    let releaseGeometryGate: (() => void) | undefined;
    geometryGate = new Promise<void>((resolve) => {
      releaseGeometryGate = resolve;
    });
    const gateEntered = new Promise<void>((resolve) => {
      notifyGeometryGateEntered = resolve;
    });
    const concurrentResponses = Promise.all([
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
        .set('Authorization', bearer(emails.dispatcher)),
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
        .set('Authorization', bearer(emails.admin)),
    ]);
    await gateEntered;
    const newerGps = { latitude: 10.815, longitude: 107.515 };
    await postLocation(emails.driver, newerGps).expect(200);
    releaseGeometryGate?.();
    const responses = await concurrentResponses;
    geometryGate = null;
    notifyGeometryGateEntered = null;
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const historyAfterRace = await prisma.lineHaulTripRoute.findMany({
      where: { tripId },
      orderBy: { version: 'asc' },
      select: { version: true, type: true, startLatitude: true, startLongitude: true },
    });
    expect(historyAfterRace.map(({ version, type }) => ({ version, type }))).toEqual([
      { version: 1, type: 'PLANNED' },
      { version: 2, type: 'REROUTE' },
      { version: 3, type: 'REROUTE' },
    ]);
    expect(Number(historyAfterRace[2].startLatitude)).toBe(concurrentPoint.latitude);
    expect(Number(historyAfterRace[2].startLongitude)).toBe(concurrentPoint.longitude);

    const currentBeforeFailure = await prisma.lineHaulTrip.findUniqueOrThrow({
      where: { id: tripId },
      select: { currentRouteId: true },
    });
    await postLocation(emails.driver, { latitude: 10.82, longitude: 107.52 }).expect(200);
    failGeometryCalculation = true;
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(503);
    failGeometryCalculation = false;
    await expect(
      prisma.lineHaulTrip.findUniqueOrThrow({
        where: { id: tripId },
        select: { currentRouteId: true },
      }),
    ).resolves.toEqual(currentBeforeFailure);
    await expect(prisma.lineHaulTripRoute.count({ where: { tripId } })).resolves.toBe(3);
  });

  it('arrival removes current visibility, ends the room, and rejects location C', async () => {
    const dispatcher = await connect(bearerToken(emails.dispatcher));
    await expect(subscribe(dispatcher, tripId)).resolves.toEqual({ subscribed: true });
    await postLocation(emails.driver, { latitude: 11, longitude: 107 }).expect(200);
    const ended = waitForEnded(dispatcher);

    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/arrive`)
      .set('Authorization', bearer(emails.destinationStaff))
      .expect(200);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/recalculate-route`)
      .set('Authorization', bearer(emails.dispatcher))
      .expect(409);
    await expect(ended).resolves.toMatchObject({ tripId, status: LineHaulTripStatus.ARRIVED });
    await expect(redis.getClient().get(`linehaul:trip:location:${tripId}`)).resolves.toBeNull();
    await postLocation(emails.driver, { latitude: 11.1, longitude: 107.1 }).expect(403);
    await expect(subscribe(dispatcher, tripId)).resolves.toEqual({ subscribed: false });

    const map = await request(server)
      .get('/api/v1/line-haul/locations')
      .set('Authorization', bearer(emails.dispatcher))
      .expect(200);
    expect(bodyFrom<MapTrip[]>(map).data.some((trip) => trip.tripId === tripId)).toBe(false);
    const driverContext = await request(server)
      .get('/api/v1/driver/line-haul/active-trip')
      .set('Authorization', bearer(emails.driver))
      .expect(200);
    expect(bodyFrom<MapTrip | null>(driverContext).data).toBeNull();
  });

  function bearer(email: string): string {
    return `Bearer ${bearerToken(email)}`;
  }

  function bearerToken(email: string): string {
    const token = tokens.get(email);
    if (!token) throw new Error(`Missing token for ${email}`);
    return token;
  }

  function postLocation(email: string, point: { latitude: number; longitude: number }) {
    return request(server)
      .post(`/api/v1/driver/line-haul/trips/${tripId}/location`)
      .set('Authorization', bearer(email))
      .send(point);
  }

  async function connect(token: string): Promise<Socket> {
    const address = server.address() as AddressInfo;
    const socket = io(`http://127.0.0.1:${address.port}/operations`, {
      auth: { token },
      forceNew: true,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return socket;
  }
});

function subscribe(socket: Socket, tripId: string): Promise<{ subscribed: boolean }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('linehaul.trip.subscribe timed out')), 5_000);
    socket.emit('linehaul.trip.subscribe', { tripId }, (response: { subscribed: boolean }) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function waitForLocation(socket: Socket): Promise<LocationPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('linehaul.location.updated timed out')),
      5_000,
    );
    socket.once('linehaul.location.updated', (payload: LocationPayload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForDeviation(
  socket: Socket,
  expectedState: DeviationPayload['state'],
): Promise<DeviationPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`linehaul.route.deviation.changed ${expectedState} timed out`)),
      5_000,
    );
    const listener = (payload: DeviationPayload) => {
      if (payload.state !== expectedState) return;
      clearTimeout(timeout);
      socket.off('linehaul.route.deviation.changed', listener);
      resolve(payload);
    };
    socket.on('linehaul.route.deviation.changed', listener);
  });
}

function waitForRouteUpdate(
  socket: Socket,
): Promise<{ tripId: string; routeVersion: number; calculatedAt: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('linehaul.route.updated timed out')), 5_000);
    socket.once(
      'linehaul.route.updated',
      (payload: { tripId: string; routeVersion: number; calculatedAt: string }) => {
        clearTimeout(timeout);
        resolve(payload);
      },
    );
  });
}

function waitForEnded(
  socket: Socket,
): Promise<{ tripId: string; status: string; arrivedAt: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('linehaul.trip.ended timed out')), 5_000);
    socket.once(
      'linehaul.trip.ended',
      (payload: { tripId: string; status: string; arrivedAt: string }) => {
        clearTimeout(timeout);
        resolve(payload);
      },
    );
  });
}
