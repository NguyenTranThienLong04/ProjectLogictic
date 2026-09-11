import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulVehicleStatus,
  ShipmentStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { DisabledRouteProvider } from '../src/modules/routing/disabled-route.provider.js';
import { ROUTE_PROVIDER } from '../src/modules/routing/route-provider.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface RecommendationPayload {
  algorithmVersion: string;
  advisoryOnly: boolean;
  criteria: { durationBasis: string; eligibleTransferCount: number };
  route: { mode: string; durationSeconds: number | null; distanceMeters: number } | null;
  recommendations: Array<{
    score: number;
    originWarehouseId: string;
    destinationWarehouseId: string;
    driver: { id: string };
    vehicle: { id: string; capacityWeightGrams: number };
    scheduledStartAt: string;
    scheduledEndAt: string;
    manifestWeightGrams: number;
    transfers: Array<{ id: string }>;
    reasons: Array<{ code: string; points: number }>;
  }>;
}

interface TripPayload {
  id: string;
  status: LineHaulTripStatus;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  manifest: { totalTransfers: number; manifestWeightGrams: number };
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase G3C3 advisory line-haul planning (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let dispatcherToken = '';
  let adminToken = '';
  let customerToken = '';
  let dispatcherId = '';
  let customerId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let wrongDestinationWarehouseId = '';
  let eligibleDriverId = '';
  let busyDriverId = '';
  let suspendedDriverId = '';
  let assignedDriverId = '';
  let eligibleVehicleId = '';
  let busyVehicleId = '';
  let maintenanceVehicleId = '';
  let busyTripId = '';
  let activeAssignmentId = '';
  let createdTripId = '';
  const shipmentIds: string[] = [];
  const transferIds: string[] = [];
  const vehicleIds: string[] = [];
  const password = 'Password@123456';
  const runId = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const emailRunId = runId.toLowerCase();
  const emails = {
    admin: `g3c3-admin-${emailRunId}@example.com`,
    dispatcher: `g3c3-dispatcher-${emailRunId}@example.com`,
    customer: `g3c3-customer-${emailRunId}@example.com`,
    drivers: Array.from(
      { length: 4 },
      (_, index) => `g3c3-driver-${index + 1}-${emailRunId}@example.com`,
    ),
  };
  const mockRedisService = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getClient: jest.fn().mockReturnValue({
      status: 'ready',
      get: jest.fn((): Promise<string | null> => Promise.resolve(null)),
      set: jest.fn((): Promise<string> => Promise.resolve('OK')),
      del: jest.fn((): Promise<number> => Promise.resolve(0)),
      mget: jest.fn((): Promise<Array<string | null>> => Promise.resolve([])),
      quit: jest.fn(),
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(ROUTE_PROVIDER)
      .useValue(new DisabledRouteProvider())
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

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const userInputs = [
      { email: emails.admin, role: UserRole.ADMIN },
      { email: emails.dispatcher, role: UserRole.DISPATCHER },
      { email: emails.customer, role: UserRole.CUSTOMER },
      ...emails.drivers.map((email) => ({ email, role: UserRole.DRIVER })),
    ];
    const users = await Promise.all(
      userInputs.map(({ email, role }) =>
        prisma.user.create({
          data: {
            email,
            fullName: `Phase G3C3 ${role}`,
            passwordHash,
            role,
            status: UserStatus.ACTIVE,
          },
        }),
      ),
    );
    const usersByEmail = new Map(users.map((user) => [user.email, user]));
    dispatcherId = usersByEmail.get(emails.dispatcher)!.id;
    customerId = usersByEmail.get(emails.customer)!.id;

    const warehouses = await Promise.all(
      [
        ['ORIGIN', 'Origin Hub', '10.7769', '106.7009'],
        ['DEST', 'Destination Hub', '16.0544', '108.2022'],
        ['WRONG', 'Wrong Route Hub', '21.0278', '105.8342'],
      ].map(([suffix, name, latitude, longitude]) =>
        prisma.warehouse.create({
          data: {
            code: `G3C3-${suffix}-${runId}`,
            name: `Phase G3C3 ${name}`,
            address: `${suffix} Planning Street`,
            city: suffix,
            latitude,
            longitude,
          },
        }),
      ),
    );
    [originWarehouseId, destinationWarehouseId, wrongDestinationWarehouseId] = warehouses.map(
      ({ id }) => id,
    );

    const profiles = await Promise.all(
      emails.drivers.map((email, index) =>
        prisma.driverProfile.create({
          data: {
            userId: usersByEmail.get(email)!.id,
            operatingWarehouseId: originWarehouseId,
            employeeCode: `G3C3-D${index + 1}-${runId}`,
            vehicleType: 'TRUCK',
            vehiclePlate: `G3C3-D${index + 1}-${runId}`,
            capabilities: [DriverCapability.LINE_HAUL],
            status: index === 2 ? DriverStatus.SUSPENDED : DriverStatus.OFFLINE,
          },
        }),
      ),
    );
    [eligibleDriverId, busyDriverId, suspendedDriverId, assignedDriverId] = profiles.map(
      ({ id }) => id,
    );

    const vehicles = await Promise.all(
      [
        ['V1', 2_000, LineHaulVehicleStatus.AVAILABLE],
        ['V2', 3_000, LineHaulVehicleStatus.AVAILABLE],
        ['V3', 10_000, LineHaulVehicleStatus.MAINTENANCE],
      ].map(([suffix, capacityWeightGrams, status], index) =>
        prisma.lineHaulVehicle.create({
          data: {
            vehicleCode: `G3C3-${suffix}-${runId}`,
            licensePlate: `G3C3-${runId.slice(0, 6)}-${index + 1}`,
            vehicleType: 'TRUCK',
            capacityWeightGrams: capacityWeightGrams as number,
            status: status as LineHaulVehicleStatus,
          },
        }),
      ),
    );
    [eligibleVehicleId, busyVehicleId, maintenanceVehicleId] = vehicles.map(({ id }) => id);
    vehicleIds.push(...vehicles.map(({ id }) => id));

    busyTripId = (
      await prisma.lineHaulTrip.create({
        data: {
          tripCode: `LHT-G3C3-BUSY-${runId}`,
          clientRequestId: randomUUID(),
          originWarehouseId,
          destinationWarehouseId,
          driverId: busyDriverId,
          vehicleId: busyVehicleId,
          scheduledStartAt: new Date('2036-03-10T01:00:00.000Z'),
          scheduledEndAt: new Date('2036-03-10T13:00:00.000Z'),
          createdById: dispatcherId,
        },
      })
    ).id;

    const createShipmentAndTransfer = async (
      suffix: string,
      weightGrams: number,
      toWarehouseId = destinationWarehouseId,
    ) => {
      const shipment = await prisma.shipment.create({
        data: {
          clientRequestId: randomUUID(),
          trackingCode: `SHP-G3C3-${suffix}-${runId}`,
          customerId,
          senderSnapshot: { fullName: 'G3C3 Sender', phone: '0900000001' },
          receiverSnapshot: { fullName: 'G3C3 Receiver', phone: '0900000002' },
          pickupSnapshot: { city: 'Origin', streetAddress: '1 Origin Street' },
          deliverySnapshot: { city: 'Destination', streetAddress: '2 Destination Street' },
          packageSnapshot: {
            description: `G3C3 package ${suffix}`,
            packageType: 'PARCEL',
            weightGrams,
            verifiedWeightGrams: weightGrams,
          },
          pricingSnapshot: { totalFee: 30_000 },
          totalFee: 30_000,
          status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
          originWarehouseId,
          destinationWarehouseId: toWarehouseId,
          currentWarehouseId: originWarehouseId,
        },
      });
      shipmentIds.push(shipment.id);
      const transfer = await prisma.warehouseTransfer.create({
        data: {
          transferCode: `TRF-G3C3-${suffix}-${runId}`,
          shipmentId: shipment.id,
          fromWarehouseId: originWarehouseId,
          toWarehouseId,
          status: WarehouseTransferStatus.PENDING,
          clientRequestId: randomUUID(),
          createdById: dispatcherId,
        },
      });
      transferIds.push(transfer.id);
      return transfer;
    };
    const assignedShipment = await prisma.shipment.create({
      data: {
        clientRequestId: randomUUID(),
        trackingCode: `SHP-G3C3-ASSIGNED-${runId}`,
        customerId,
        senderSnapshot: { fullName: 'G3C3 Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'G3C3 Receiver', phone: '0900000002' },
        pickupSnapshot: { city: 'Origin', streetAddress: '1 Origin Street' },
        deliverySnapshot: { city: 'Destination', streetAddress: '2 Destination Street' },
        packageSnapshot: { description: 'Assigned package', weightGrams: 100 },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        status: ShipmentStatus.PICKUP_ASSIGNED,
        originWarehouseId,
        destinationWarehouseId,
      },
    });
    shipmentIds.push(assignedShipment.id);
    activeAssignmentId = (
      await prisma.driverAssignment.create({
        data: {
          shipmentId: assignedShipment.id,
          driverId: assignedDriverId,
          type: 'PICKUP',
          status: 'PENDING',
          clientRequestId: randomUUID(),
          assignedById: dispatcherId,
        },
      })
    ).id;
    await createShipmentAndTransfer('A', 1_200);
    await createShipmentAndTransfer('B', 600);
    await createShipmentAndTransfer('WRONG', 500, wrongDestinationWarehouseId);

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [adminToken, dispatcherToken, customerToken] = await Promise.all([
      login(emails.admin),
      login(emails.dispatcher),
      login(emails.customer),
    ]);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (activeAssignmentId)
      await prisma.driverAssignment.delete({ where: { id: activeAssignmentId } });
    const tripIds = [busyTripId, createdTripId].filter(Boolean);
    if (tripIds.length > 0) {
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
    }
    await prisma.auditLog.deleteMany({
      where: {
        actorId: dispatcherId,
        entityType: { in: ['LineHaulTrip', 'LineHaulTripTransfer'] },
      },
    });
    await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    const users = await prisma.user.findMany({
      where: {
        email: { in: [emails.admin, emails.dispatcher, emails.customer, ...emails.drivers] },
      },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.lineHaulVehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    await prisma.warehouse.deleteMany({
      where: {
        id: { in: [originWarehouseId, destinationWarehouseId, wrongDestinationWarehouseId] },
      },
    });
    await app.close();
  });

  const recommendationQuery = {
    originWarehouseId: () => originWarehouseId,
    destinationWarehouseId: () => destinationWarehouseId,
    earliestStartAt: '2036-03-10T01:00:00.000Z',
    latestEndAt: '2036-03-10T13:00:00.000Z',
    maxRecommendations: '5',
  };

  const getRecommendations = (token: string) =>
    request(server)
      .get('/api/v1/line-haul/planning/recommendations')
      .set('Authorization', `Bearer ${token}`)
      .query({
        originWarehouseId: recommendationQuery.originWarehouseId(),
        destinationWarehouseId: recommendationQuery.destinationWarehouseId(),
        earliestStartAt: recommendationQuery.earliestStartAt,
        latestEndAt: recommendationQuery.latestEndAt,
        maxRecommendations: recommendationQuery.maxRecommendations,
      });

  let selectedRecommendation: RecommendationPayload['recommendations'][number];

  it('ranks only exact-route, available, conflict-free and non-overloaded resources with provider disabled', async () => {
    const response = await getRecommendations(dispatcherToken).expect(200);
    const result = bodyFrom<RecommendationPayload>(response).data;
    expect(result).toMatchObject({
      algorithmVersion: 'G3C3_RULES_V1',
      advisoryOnly: true,
      criteria: { durationBasis: 'POLICY_FALLBACK' },
      route: { mode: 'HAVERSINE_FALLBACK', durationSeconds: null },
    });
    expect(result.recommendations.length).toBeGreaterThan(0);
    const allDrivers = result.recommendations.map(({ driver }) => driver.id);
    const allVehicles = result.recommendations.map(({ vehicle }) => vehicle.id);
    expect(allDrivers).not.toContain(busyDriverId);
    expect(allDrivers).not.toContain(suspendedDriverId);
    expect(allDrivers).not.toContain(assignedDriverId);
    expect(allVehicles).not.toContain(busyVehicleId);
    expect(allVehicles).not.toContain(maintenanceVehicleId);
    expect(allDrivers).toContain(eligibleDriverId);
    expect(allVehicles).toContain(eligibleVehicleId);
    expect(
      result.recommendations.every(
        (recommendation) =>
          recommendation.originWarehouseId === originWarehouseId &&
          recommendation.destinationWarehouseId === destinationWarehouseId &&
          recommendation.manifestWeightGrams <= recommendation.vehicle.capacityWeightGrams &&
          recommendation.transfers.every((transfer) =>
            transferIds.slice(0, 2).includes(transfer.id),
          ),
      ),
    ).toBe(true);
    expect(result.criteria.eligibleTransferCount).toBe(2);
    expect(result.recommendations[0].reasons.map(({ code }) => code)).toEqual([
      'CAPACITY_UTILIZATION',
      'TRANSFER_CONSOLIDATION',
      'EARLY_DEPARTURE',
      'ROUTE_METRIC_QUALITY',
      'DRIVER_ORIGIN_ALIGNMENT',
    ]);
    selectedRecommendation = result.recommendations[0];
  });

  it('enforces RBAC on the advisory read endpoint', async () => {
    await getRecommendations(adminToken).expect(200);
    await getRecommendations(customerToken).expect(403);
  });

  it('rejects a stale recommendation at create validation, then creates a reviewed plan atomically', async () => {
    await prisma.lineHaulVehicle.update({
      where: { id: selectedRecommendation.vehicle.id },
      data: { status: LineHaulVehicleStatus.MAINTENANCE },
    });
    const input = {
      clientRequestId: randomUUID(),
      originWarehouseId: selectedRecommendation.originWarehouseId,
      destinationWarehouseId: selectedRecommendation.destinationWarehouseId,
      driverId: selectedRecommendation.driver.id,
      vehicleId: selectedRecommendation.vehicle.id,
      scheduledStartAt: selectedRecommendation.scheduledStartAt,
      scheduledEndAt: selectedRecommendation.scheduledEndAt,
      warehouseTransferIds: selectedRecommendation.transfers.map(({ id }) => id),
    };
    const staleResponse = await request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send(input)
      .expect(409);
    expect(staleResponse.body).toMatchObject({ code: 'LINE_HAUL_VEHICLE_NOT_AVAILABLE' });
    expect(
      await prisma.lineHaulTrip.count({ where: { clientRequestId: input.clientRequestId } }),
    ).toBe(0);

    await prisma.lineHaulVehicle.update({
      where: { id: selectedRecommendation.vehicle.id },
      data: { status: LineHaulVehicleStatus.AVAILABLE },
    });
    const createResponse = await request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ ...input, clientRequestId: randomUUID() })
      .expect(201);
    const trip = bodyFrom<TripPayload>(createResponse).data;
    createdTripId = trip.id;
    expect(trip).toMatchObject({
      status: LineHaulTripStatus.PLANNED,
      scheduledStartAt: selectedRecommendation.scheduledStartAt,
      scheduledEndAt: selectedRecommendation.scheduledEndAt,
      manifest: {
        totalTransfers: selectedRecommendation.transfers.length,
        manifestWeightGrams: selectedRecommendation.manifestWeightGrams,
      },
    });
    expect(
      await prisma.lineHaulTripTransfer.count({ where: { tripId: trip.id, isActive: true } }),
    ).toBe(selectedRecommendation.transfers.length);
  });
});
