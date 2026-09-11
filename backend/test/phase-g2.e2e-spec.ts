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
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ROUTE_PROVIDER, type RouteProvider } from '../src/modules/routing/route-provider.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface TripPayload {
  id: string;
  tripCode: string;
  status: LineHaulTripStatus;
  departedAt: string | null;
  arrivedAt: string | null;
  plannedRoute: {
    distanceMeters: number;
    durationSeconds: number | null;
    mode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
    provider: string;
    calculatedAt: string;
  } | null;
  manifest: {
    totalTransfers: number;
    receivedTransfers: number;
    manifestWeightGrams: number;
    vehicleCapacityWeightGrams: number | null;
    remainingCapacityWeightGrams: number | null;
    capacityUtilizationPercent: number | null;
    preparedManifestWeightGrams: number | null;
    preparedVehicleCapacityWeightGrams: number | null;
  };
  availableActions: {
    addTransfer: boolean;
    markReady: boolean;
    dispatch: boolean;
    arrive: boolean;
    receiveTransfers: boolean;
  };
  vehicle: { id: string; status: LineHaulVehicleStatus };
  transferAssignments: Array<{
    id: string;
    isActive: boolean;
    removedAt: string | null;
    warehouseTransfer: {
      id: string;
      status: WarehouseTransferStatus;
      shipment: { id: string; trackingCode: string; status: ShipmentStatus };
    };
  }>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase G2 line-haul load, dispatch, arrival and unload (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken = '';
  let dispatcherToken = '';
  let originStaffToken = '';
  let destinationStaffToken = '';
  let wrongStaffToken = '';
  let dispatcherId = '';
  let customerId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let wrongWarehouseId = '';
  let originStaffId = '';
  let destinationStaffId = '';
  let wrongStaffId = '';
  let lineHaulDriverId = '';
  let secondaryDriverId = '';
  let mainVehicleId = '';
  let secondaryVehicleId = '';
  let shipmentId = '';
  let trackingCode = '';
  let transferId = '';
  let tripId = '';
  let plannedRouteSnapshot: TripPayload['plannedRoute'] = null;
  const password = 'Password@123456';
  const runId = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const emailRunId = runId.toLowerCase();
  const emails = {
    admin: `g2-admin-${emailRunId}@example.com`,
    dispatcher: `g2-dispatcher-${emailRunId}@example.com`,
    customer: `g2-customer-${emailRunId}@example.com`,
    originStaff: `g2-origin-${emailRunId}@example.com`,
    destinationStaff: `g2-destination-${emailRunId}@example.com`,
    wrongStaff: `g2-wrong-${emailRunId}@example.com`,
    lineHaulDriver: `g2-line-haul-${emailRunId}@example.com`,
    secondaryDriver: `g2-secondary-${emailRunId}@example.com`,
  };
  const mockRedisService = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getClient: jest.fn().mockReturnValue({
      status: 'ready',
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      mget: jest.fn(),
      quit: jest.fn(),
    }),
  };
  const routeCalculate = jest.fn(() =>
    Promise.resolve({
      distanceMeters: 965_000,
      durationSeconds: 57_600,
      provider: 'PHASE_G2_ROAD',
      calculatedAt: new Date('2026-09-05T02:00:00.000Z'),
    }),
  );
  const routeProvider: RouteProvider = {
    identifier: 'PHASE_G2_ROAD',
    enabled: true,
    calculate: routeCalculate,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
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

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const users = await Promise.all(
      Object.entries(emails).map(([key, email]) =>
        prisma.user.create({
          data: {
            email,
            fullName: `Phase G2 ${key}`,
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
    originStaffId = usersByEmail.get(emails.originStaff)!.id;
    destinationStaffId = usersByEmail.get(emails.destinationStaff)!.id;
    wrongStaffId = usersByEmail.get(emails.wrongStaff)!.id;

    const warehouses = await Promise.all(
      [
        ['ORIGIN', 'Phase G2 Origin Hub', 'Ho Chi Minh City'],
        ['DEST', 'Phase G2 Destination Hub', 'Da Nang'],
        ['WRONG', 'Phase G2 Wrong Hub', 'Ha Noi'],
      ].map(([suffix, name, city]) =>
        prisma.warehouse.create({
          data: {
            code: `G2-${suffix}-${runId}`,
            name,
            address: `${suffix} operational address`,
            city,
            latitude: suffix === 'ORIGIN' ? 10.7769 : suffix === 'DEST' ? 16.0544 : 21.0285,
            longitude: suffix === 'ORIGIN' ? 106.7009 : suffix === 'DEST' ? 108.2022 : 105.8542,
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
          userId: originStaffId,
          warehouseId: originWarehouseId,
          staffCode: `G2-O-${runId}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: destinationStaffId,
          warehouseId: destinationWarehouseId,
          staffCode: `G2-D-${runId}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: wrongStaffId,
          warehouseId: wrongWarehouseId,
          staffCode: `G2-W-${runId}`,
        },
      }),
    ]);
    const drivers = await Promise.all([
      prisma.driverProfile.create({
        data: {
          userId: usersByEmail.get(emails.lineHaulDriver)!.id,
          operatingWarehouseId: originWarehouseId,
          employeeCode: `G2-LH-${runId}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `G2-LH-${runId}`,
          capabilities: [
            DriverCapability.PICKUP,
            DriverCapability.DELIVERY,
            DriverCapability.LINE_HAUL,
          ],
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        },
      }),
      prisma.driverProfile.create({
        data: {
          userId: usersByEmail.get(emails.secondaryDriver)!.id,
          operatingWarehouseId: originWarehouseId,
          employeeCode: `G2-SECOND-${runId}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `G2-S-${runId}`,
          capabilities: [DriverCapability.LINE_HAUL],
          status: DriverStatus.OFFLINE,
        },
      }),
    ]);
    [lineHaulDriverId, secondaryDriverId] = drivers.map((driver) => driver.id);

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [adminToken, dispatcherToken, originStaffToken, destinationStaffToken, wrongStaffToken] =
      await Promise.all([
        login(emails.admin),
        login(emails.dispatcher),
        login(emails.originStaff),
        login(emails.destinationStaff),
        login(emails.wrongStaff),
      ]);

    const createVehicle = async (suffix: string) => {
      const response = await request(server)
        .post('/api/v1/line-haul/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vehicleCode: `G2V-${runId}-${suffix}`,
          licensePlate: `51C-${runId.slice(0, 5)}-${suffix}`,
          vehicleType: 'TRUCK',
          capacityWeightGrams: 8_000_000,
        })
        .expect(201);
      return bodyFrom<{ id: string }>(response).data.id;
    };
    [mainVehicleId, secondaryVehicleId] = await Promise.all([
      createVehicle('01'),
      createVehicle('02'),
    ]);

    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-G2-${runId}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: 'G2 Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'G2 Receiver', phone: '0900000002' },
        pickupSnapshot: {
          city: 'Ho Chi Minh City',
          streetAddress: '1 Origin Street',
          latitude: 10.8,
          longitude: 106.6,
        },
        deliverySnapshot: { city: 'Da Nang', streetAddress: '2 Destination Street' },
        packageSnapshot: {
          description: 'G2 integration package',
          packageType: 'PARCEL',
          weightGrams: 2_000,
          lengthCm: 30,
          widthCm: 20,
          heightCm: 15,
        },
        pricingSnapshot: { totalFee: 35_000 },
        totalFee: 35_000,
        status: ShipmentStatus.PICKED_UP,
        originWarehouseId,
        currentWarehouseId: null,
        pickedUpAt: new Date(),
      },
    });
    shipmentId = shipment.id;
    trackingCode = shipment.trackingCode;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    const trips = await prisma.lineHaulTrip.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const tripIds = trips.map((trip) => trip.id);
    await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.lineHaulTrip.updateMany({
      where: { id: { in: tripIds } },
      data: { currentRouteId: null },
    });
    await prisma.lineHaulTripRoute.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.lineHaulVehicle.deleteMany({
      where: { vehicleCode: { startsWith: `G2V-${runId}` } },
    });
    const shipments = await prisma.shipment.findMany({
      where: { customerId },
      select: { id: true },
    });
    const shipmentIds = shipments.map((shipment) => shipment.id);
    await prisma.warehouseTransfer.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.warehouse.deleteMany({
      where: { id: { in: [originWarehouseId, destinationWarehouseId, wrongWarehouseId] } },
    });
    await app.close();
  });

  const createTrip = (driverId: string, vehicleId: string) =>
    request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        clientRequestId: randomUUID(),
        originWarehouseId,
        destinationWarehouseId,
        driverId,
        vehicleId,
        plannedDepartureAt: '2026-09-05T08:00:00.000Z',
      });

  let scheduleSequence = 0;
  const scheduleTrip = async (id: string) => {
    const day = 10 + scheduleSequence++;
    await request(server)
      .post(`/api/v1/line-haul/trips/${id}/schedule`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        expectedVersion: 0,
        scheduledStartAt: `2026-10-${String(day).padStart(2, '0')}T03:00:00.000Z`,
        scheduledEndAt: `2026-10-${String(day).padStart(2, '0')}T05:00:00.000Z`,
      })
      .expect(200);
  };

  it('rejects READY without a valid manifest and dispatch from PLANNED', async () => {
    const emptyTripResponse = await createTrip(secondaryDriverId, secondaryVehicleId).expect(201);
    const emptyTripId = bodyFrom<{ id: string }>(emptyTripResponse).data.id;
    await scheduleTrip(emptyTripId);
    await request(server)
      .post(`/api/v1/line-haul/trips/${emptyTripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${emptyTripId}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${emptyTripId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ reason: 'Kết thúc negative test manifest rỗng' })
      .expect(200);

    const wrongRouteTripResponse = await createTrip(secondaryDriverId, secondaryVehicleId).expect(
      201,
    );
    const wrongRouteTripId = bodyFrom<{ id: string }>(wrongRouteTripResponse).data.id;
    await scheduleTrip(wrongRouteTripId);
    const wrongRouteTransfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `TRF-G2-WR-${runId}`,
        shipmentId,
        fromWarehouseId: originWarehouseId,
        toWarehouseId: wrongWarehouseId,
        status: WarehouseTransferStatus.PENDING,
        clientRequestId: randomUUID(),
        createdById: originStaffId,
      },
    });
    const wrongRouteAssignment = await prisma.lineHaulTripTransfer.create({
      data: {
        tripId: wrongRouteTripId,
        warehouseTransferId: wrongRouteTransfer.id,
        assignedById: dispatcherId,
      },
    });
    await request(server)
      .post(`/api/v1/line-haul/trips/${wrongRouteTripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${wrongRouteTripId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ reason: 'End wrong-route READY negative test' })
      .expect(200);
    await prisma.lineHaulTripTransfer.delete({ where: { id: wrongRouteAssignment.id } });
    await prisma.warehouseTransfer.delete({ where: { id: wrongRouteTransfer.id } });
  });

  it('checks in, sorts and creates the canonical pending WarehouseTransfer', async () => {
    const checkIn = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({
        trackingCode,
        packageVerified: true,
        actualWeightGrams: 2_050,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 15,
      })
      .expect(200);
    expect(bodyFrom<{ shipment: { status: ShipmentStatus } }>(checkIn).data.shipment.status).toBe(
      ShipmentStatus.AT_ORIGIN_WAREHOUSE,
    );
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/shipments/${shipmentId}/route-destination`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({ destinationWarehouseId })
      .expect(201);
    const transferResponse = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({
        shipmentId,
        toWarehouseId: destinationWarehouseId,
        clientRequestId: randomUUID(),
        note: 'G2 canonical line-haul manifest',
      })
      .expect(201);
    const transfer = bodyFrom<{ id: string; status: WarehouseTransferStatus }>(
      transferResponse,
    ).data;
    transferId = transfer.id;
    expect(transfer.status).toBe(WarehouseTransferStatus.PENDING);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment).toMatchObject({
      status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
      currentWarehouseId: originWarehouseId,
    });
  });

  it('enforces G3C1 capacity, concurrent adds and immutable READY snapshots', async () => {
    await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleCode: `G2V-${runId}-NO-CAP`,
        licensePlate: `51C-${runId.slice(0, 5)}-NC`,
        vehicleType: 'TRUCK',
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({ capacityWeightGrams: 1_000_000 })
      .expect(403);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 0 })
      .expect(400);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: -1 })
      .expect(400);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 1_000_000 })
      .expect(200);

    const legacyVehicle = await prisma.lineHaulVehicle.create({
      data: {
        vehicleCode: `G2V-${runId}-LEGACY`,
        licensePlate: `51C-${runId.slice(0, 5)}-LG`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: null,
      },
    });
    const eligibleVehicles = await request(server)
      .get('/api/v1/line-haul/trips/eligible-vehicles')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(
      bodyFrom<Array<{ id: string }>>(eligibleVehicles).data.some(
        (vehicle) => vehicle.id === legacyVehicle.id,
      ),
    ).toBe(false);
    const invalidCapacityTrip = await createTrip(secondaryDriverId, legacyVehicle.id).expect(409);
    expect(invalidCapacityTrip.body).toMatchObject({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_REQUIRED',
    });
    await prisma.lineHaulVehicle.delete({ where: { id: legacyVehicle.id } });

    const createCapacityTransfer = async (suffix: string, weightGrams: number) => {
      const shipment = await prisma.shipment.create({
        data: {
          trackingCode: `SHP-G3C1-${suffix}-${runId}`,
          clientRequestId: randomUUID(),
          customerId,
          senderSnapshot: { fullName: 'G3C1 Sender', phone: '0900000001' },
          receiverSnapshot: { fullName: 'G3C1 Receiver', phone: '0900000002' },
          pickupSnapshot: { city: 'Ho Chi Minh City', streetAddress: 'Origin' },
          deliverySnapshot: { city: 'Da Nang', streetAddress: 'Destination' },
          packageSnapshot: {
            description: `G3C1 ${suffix}`,
            packageType: 'PARCEL',
            weightGrams,
            verifiedWeightGrams: weightGrams,
            lengthCm: 20,
            widthCm: 20,
            heightCm: 20,
          },
          pricingSnapshot: { totalFee: 30_000 },
          totalFee: 30_000,
          status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
          originWarehouseId,
          destinationWarehouseId,
          currentWarehouseId: originWarehouseId,
        },
      });
      return prisma.warehouseTransfer.create({
        data: {
          transferCode: `TRF-G3C1-${suffix}-${runId}`,
          shipmentId: shipment.id,
          fromWarehouseId: originWarehouseId,
          toWarehouseId: destinationWarehouseId,
          status: WarehouseTransferStatus.PENDING,
          clientRequestId: randomUUID(),
          createdById: originStaffId,
        },
      });
    };

    const [baseA, baseB, concurrentA, concurrentB, overByOne, exactRemainder] = await Promise.all([
      createCapacityTransfer('BASE-A', 400_000),
      createCapacityTransfer('BASE-B', 400_000),
      createCapacityTransfer('CON-A', 150_000),
      createCapacityTransfer('CON-B', 150_000),
      createCapacityTransfer('OVER-1', 200_001),
      createCapacityTransfer('EXACT', 200_000),
    ]);
    const capacityTripResponse = await createTrip(secondaryDriverId, secondaryVehicleId).expect(
      201,
    );
    const capacityTripId = bodyFrom<{ id: string }>(capacityTripResponse).data.id;
    await scheduleTrip(capacityTripId);
    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({ transferId: baseA.id })
      .expect(403);
    for (const item of [baseA, baseB]) {
      await request(server)
        .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ transferId: item.id })
        .expect(200);
    }
    const atEightHundred = await request(server)
      .get(`/api/v1/line-haul/trips/${capacityTripId}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(atEightHundred).data.manifest).toMatchObject({
      manifestWeightGrams: 800_000,
      vehicleCapacityWeightGrams: 1_000_000,
      remainingCapacityWeightGrams: 200_000,
      capacityUtilizationPercent: 80,
    });

    const [concurrentFirst, concurrentSecond] = await Promise.all([
      request(server)
        .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ transferId: concurrentA.id }),
      request(server)
        .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ transferId: concurrentB.id }),
    ]);
    expect([concurrentFirst.status, concurrentSecond.status].sort()).toEqual([200, 409]);
    const activeConcurrentAssignment = await prisma.lineHaulTripTransfer.findFirstOrThrow({
      where: {
        tripId: capacityTripId,
        warehouseTransferId: { in: [concurrentA.id, concurrentB.id] },
        isActive: true,
      },
    });
    expect(
      await prisma.lineHaulTripTransfer.count({
        where: {
          tripId: capacityTripId,
          warehouseTransferId: { in: [concurrentA.id, concurrentB.id] },
          isActive: true,
        },
      }),
    ).toBe(1);
    const afterConcurrent = await request(server)
      .get(`/api/v1/line-haul/trips/${capacityTripId}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(afterConcurrent).data.manifest.manifestWeightGrams).toBe(950_000);

    await request(server)
      .post(
        `/api/v1/line-haul/trips/${capacityTripId}/transfers/${activeConcurrentAssignment.warehouseTransferId}/remove`,
      )
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const afterRemove = await request(server)
      .get(`/api/v1/line-haul/trips/${capacityTripId}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(afterRemove).data.manifest.manifestWeightGrams).toBe(800_000);

    const candidates = await request(server)
      .get(`/api/v1/line-haul/trips/${capacityTripId}/eligible-transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const candidateItems = bodyFrom<
      Array<{
        id: string;
        loadWeightGrams: number;
        fitsVehicleCapacity: boolean;
        remainingCapacityAfterAddGrams: number;
      }>
    >(candidates).data;
    expect(candidateItems.find((item) => item.id === overByOne.id)).toMatchObject({
      loadWeightGrams: 200_001,
      fitsVehicleCapacity: false,
      remainingCapacityAfterAddGrams: -1,
    });
    expect(candidateItems.find((item) => item.id === exactRemainder.id)).toMatchObject({
      loadWeightGrams: 200_000,
      fitsVehicleCapacity: true,
      remainingCapacityAfterAddGrams: 0,
    });

    const successAuditsBeforeReject = await prisma.auditLog.count({
      where: { action: 'LINE_HAUL_TRANSFER_ASSIGNED', actorId: dispatcherId },
    });
    const overResponse = await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: overByOne.id })
      .expect(409);
    expect(overResponse.body).toMatchObject({ code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'LINE_HAUL_TRANSFER_ASSIGNED', actorId: dispatcherId },
      }),
    ).toBe(successAuditsBeforeReject);
    expect(
      await prisma.lineHaulTripTransfer.count({
        where: { tripId: capacityTripId, warehouseTransferId: overByOne.id },
      }),
    ).toBe(0);

    const capacityAuditBeforeReject = await prisma.auditLog.count({
      where: {
        action: 'LINE_HAUL_VEHICLE_CAPACITY_UPDATED',
        entityId: secondaryVehicleId,
      },
    });
    const capacityReduction = await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 799_999 })
      .expect(409);
    expect(capacityReduction.body).toMatchObject({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED',
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'LINE_HAUL_VEHICLE_CAPACITY_UPDATED',
          entityId: secondaryVehicleId,
        },
      }),
    ).toBe(capacityAuditBeforeReject);

    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 900_000 })
      .expect(200);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 1_000_000 })
      .expect(200);
    const exactFull = await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: exactRemainder.id })
      .expect(200);
    expect(bodyFrom<TripPayload>(exactFull).data.manifest).toMatchObject({
      manifestWeightGrams: 1_000_000,
      remainingCapacityWeightGrams: 0,
      capacityUtilizationPercent: 100,
    });

    await prisma.lineHaulVehicle.update({
      where: { id: secondaryVehicleId },
      data: { capacityWeightGrams: 999_999 },
    });
    const overloadedReady = await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    expect(overloadedReady.body).toMatchObject({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED',
    });
    expect(
      await prisma.lineHaulTrip.findUniqueOrThrow({
        where: { id: capacityTripId },
        select: { status: true, preparedManifestWeightGrams: true },
      }),
    ).toEqual({
      status: LineHaulTripStatus.PLANNED,
      preparedManifestWeightGrams: null,
    });
    await prisma.lineHaulVehicle.update({
      where: { id: secondaryVehicleId },
      data: { capacityWeightGrams: 1_000_000 },
    });

    const ready = await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(ready).data.manifest).toMatchObject({
      preparedManifestWeightGrams: 1_000_000,
      preparedVehicleCapacityWeightGrams: 1_000_000,
    });
    const readyAuditCount = await prisma.auditLog.count({
      where: {
        action: 'LINE_HAUL_TRIP_READY',
        entityId: capacityTripId,
      },
    });
    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/prepare`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: { action: 'LINE_HAUL_TRIP_READY', entityId: capacityTripId },
      }),
    ).toBe(readyAuditCount);

    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers/${baseA.id}/remove`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: overByOne.id })
      .expect(409);

    await prisma.lineHaulVehicle.update({
      where: { id: secondaryVehicleId },
      data: { capacityWeightGrams: 999_999 },
    });
    const overloadedDispatch = await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    expect(overloadedDispatch.body).toMatchObject({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED',
    });
    await prisma.lineHaulVehicle.update({
      where: { id: secondaryVehicleId },
      data: { capacityWeightGrams: 1_000_000 },
    });

    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 1_200_000 })
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${capacityTripId}/arrive`)
      .set('Authorization', `Bearer ${destinationStaffToken}`)
      .expect(200);
    for (const item of [baseA, baseB, exactRemainder]) {
      await request(server)
        .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${item.id}/receive`)
        .set('Authorization', `Bearer ${destinationStaffToken}`)
        .send({ note: 'G3C1 unload validation' })
        .expect(200);
    }
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${secondaryVehicleId}/update-capacity`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacityWeightGrams: 2_000_000 })
      .expect(200);
    const historical = await request(server)
      .get(`/api/v1/line-haul/trips/${capacityTripId}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(historical).data.manifest).toMatchObject({
      manifestWeightGrams: 1_000_000,
      vehicleCapacityWeightGrams: 2_000_000,
      preparedManifestWeightGrams: 1_000_000,
      preparedVehicleCapacityWeightGrams: 1_000_000,
    });
  });

  it('plans, loads and locks the manifest as READY idempotently', async () => {
    const routeCallsBeforeReady = routeCalculate.mock.calls.length;
    const tripResponse = await createTrip(lineHaulDriverId, mainVehicleId).expect(201);
    tripId = bodyFrom<{ id: string }>(tripResponse).data.id;
    await scheduleTrip(tripId);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId })
      .expect(200);

    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .expect(409);

    const firstReady = await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const ready = bodyFrom<TripPayload>(firstReady).data;
    expect(ready).toMatchObject({
      status: LineHaulTripStatus.READY,
      manifest: { totalTransfers: 1, receivedTransfers: 0 },
      availableActions: { addTransfer: false, dispatch: true },
      plannedRoute: {
        distanceMeters: 965_000,
        durationSeconds: 57_600,
        mode: 'ROAD_ROUTE',
        provider: 'PHASE_G2_ROAD',
      },
    });
    plannedRouteSnapshot = ready.plannedRoute;
    expect(routeCalculate).toHaveBeenCalledTimes(routeCallsBeforeReady + 1);
    const readyAuditCount = await prisma.auditLog.count({
      where: { entityType: 'LineHaulTrip', entityId: tripId, action: 'LINE_HAUL_TRIP_READY' },
    });
    const retriedReady = await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(retriedReady).data.plannedRoute).toEqual(plannedRouteSnapshot);
    expect(routeCalculate).toHaveBeenCalledTimes(routeCallsBeforeReady + 1);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'LineHaulTrip', entityId: tripId, action: 'LINE_HAUL_TRIP_READY' },
      }),
    ).toBe(readyAuditCount);

    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/transfers/${transferId}/remove`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId })
      .expect(409);
  });

  it('revalidates vehicle, driver and conflicting multi-role ownership before dispatch', async () => {
    await prisma.lineHaulVehicle.update({
      where: { id: mainVehicleId },
      data: { status: LineHaulVehicleStatus.MAINTENANCE },
    });
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await prisma.lineHaulVehicle.update({
      where: { id: mainVehicleId },
      data: { status: LineHaulVehicleStatus.AVAILABLE },
    });

    await prisma.driverProfile.update({
      where: { id: lineHaulDriverId },
      data: { capabilities: [DriverCapability.PICKUP, DriverCapability.DELIVERY] },
    });
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await prisma.driverProfile.update({
      where: { id: lineHaulDriverId },
      data: {
        capabilities: [
          DriverCapability.PICKUP,
          DriverCapability.DELIVERY,
          DriverCapability.LINE_HAUL,
        ],
      },
    });

    const assignmentShipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-G2-ASSIGN-${runId}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: 'Assignment sender' },
        receiverSnapshot: { fullName: 'Assignment receiver' },
        pickupSnapshot: { city: 'Ho Chi Minh City', latitude: 10.8, longitude: 106.6 },
        deliverySnapshot: { city: 'Da Nang' },
        packageSnapshot: { description: 'Ownership test', packageType: 'PARCEL', weightGrams: 500 },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
      },
    });
    const conflict = await request(server)
      .post(`/api/v1/dispatcher/shipments/${assignmentShipment.id}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ driverId: lineHaulDriverId, clientRequestId: randomUUID() })
      .expect(409);
    expect(conflict.body).toMatchObject({ code: 'DRIVER_ACTIVE_LINE_HAUL_TRIP' });
  });

  it('dispatches trip, vehicle, transfer and shipment atomically under concurrent retries', async () => {
    const beforeTracking = await prisma.trackingEvent.count({
      where: { shipmentId, type: 'WAREHOUSE_TRANSFER_DISPATCHED' },
    });
    const [first, second] = await Promise.all([
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/dispatch`)
        .set('Authorization', `Bearer ${dispatcherToken}`),
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/dispatch`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const dispatched = bodyFrom<TripPayload>(first).data;
    expect(dispatched.status).toBe(LineHaulTripStatus.IN_TRANSIT);
    expect(dispatched.departedAt).toBeTruthy();
    expect(dispatched.plannedRoute).toEqual(plannedRouteSnapshot);

    const [trip, vehicle, transfer, shipment] = await Promise.all([
      prisma.lineHaulTrip.findUniqueOrThrow({ where: { id: tripId } }),
      prisma.lineHaulVehicle.findUniqueOrThrow({ where: { id: mainVehicleId } }),
      prisma.warehouseTransfer.findUniqueOrThrow({ where: { id: transferId } }),
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ]);
    expect(trip.status).toBe(LineHaulTripStatus.IN_TRANSIT);
    expect(trip).toMatchObject({
      plannedDistanceMeters: plannedRouteSnapshot?.distanceMeters,
      plannedDurationSeconds: plannedRouteSnapshot?.durationSeconds,
      routeMetricMode: plannedRouteSnapshot?.mode,
      routeProvider: plannedRouteSnapshot?.provider,
    });
    expect(trip.routeCalculatedAt?.toISOString()).toBe(plannedRouteSnapshot?.calculatedAt);
    expect(vehicle.status).toBe(LineHaulVehicleStatus.IN_USE);
    expect(transfer.status).toBe(WarehouseTransferStatus.IN_TRANSIT);
    expect(shipment).toMatchObject({
      status: ShipmentStatus.IN_TRANSIT,
      currentWarehouseId: null,
    });
    expect(
      await prisma.trackingEvent.count({
        where: { shipmentId, type: 'WAREHOUSE_TRANSFER_DISPATCHED' },
      }),
    ).toBe(beforeTracking + 1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'LineHaulTrip',
          entityId: tripId,
          action: 'LINE_HAUL_TRIP_DISPATCHED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'WAREHOUSE_TRANSFER',
          entityId: transferId,
          action: 'WAREHOUSE_TRANSFER_DISPATCHED',
        },
      }),
    ).toBe(1);

    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ reason: 'Không được hủy sau departure' })
      .expect(409);
    await createTrip(secondaryDriverId, mainVehicleId).expect(409);
  });

  it('requires destination-scoped arrival before receive and releases the vehicle at ARRIVED', async () => {
    await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${destinationStaffToken}`)
      .send({})
      .expect(409);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/arrive`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/line-haul/trips/${tripId}/arrive`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .expect(403);

    const [first, second] = await Promise.all([
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/arrive`)
        .set('Authorization', `Bearer ${destinationStaffToken}`),
      request(server)
        .post(`/api/v1/line-haul/trips/${tripId}/arrive`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const arrived = bodyFrom<TripPayload>(first).data;
    expect(arrived.status).toBe(LineHaulTripStatus.ARRIVED);
    expect(arrived.arrivedAt).toBeTruthy();
    expect(arrived.manifest).toMatchObject({ totalTransfers: 1, receivedTransfers: 0 });
    expect(
      await prisma.lineHaulVehicle.findUniqueOrThrow({ where: { id: mainVehicleId } }),
    ).toMatchObject({ status: LineHaulVehicleStatus.AVAILABLE });
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'LineHaulTrip', entityId: tripId, action: 'LINE_HAUL_TRIP_ARRIVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.trackingEvent.count({
        where: { shipmentId, type: 'LINE_HAUL_TRIP_ARRIVED' },
      }),
    ).toBe(1);
  });

  it('receives once at the exact destination and advances to delivery readiness', async () => {
    await request(server)
      .post(`/api/v1/warehouses/${wrongWarehouseId}/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${wrongStaffToken}`)
      .send({})
      .expect(403);
    const beforeReceiveTracking = await prisma.trackingEvent.count({
      where: { shipmentId, type: 'WAREHOUSE_TRANSFER_RECEIVED' },
    });
    const [first, second] = await Promise.all([
      request(server)
        .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transferId}/receive`)
        .set('Authorization', `Bearer ${destinationStaffToken}`)
        .send({ note: 'Unload scan 1' }),
      request(server)
        .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transferId}/receive`)
        .set('Authorization', `Bearer ${destinationStaffToken}`)
        .send({ note: 'Retry receive' }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const [transfer, shipment] = await Promise.all([
      prisma.warehouseTransfer.findUniqueOrThrow({ where: { id: transferId } }),
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ]);
    expect(transfer.status).toBe(WarehouseTransferStatus.COMPLETED);
    expect(transfer.receivedAt).toBeTruthy();
    expect(shipment).toMatchObject({
      status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
      currentWarehouseId: destinationWarehouseId,
    });
    expect(
      await prisma.trackingEvent.count({
        where: { shipmentId, type: 'WAREHOUSE_TRANSFER_RECEIVED' },
      }),
    ).toBe(beforeReceiveTracking + 1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: 'WAREHOUSE_TRANSFER',
          entityId: transferId,
          action: 'WAREHOUSE_TRANSFER_RECEIVED',
        },
      }),
    ).toBe(1);

    const detail = await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}`)
      .set('Authorization', `Bearer ${destinationStaffToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(detail).data).toMatchObject({
      status: LineHaulTripStatus.ARRIVED,
      manifest: { totalTransfers: 1, receivedTransfers: 1 },
      transferAssignments: [expect.objectContaining({ isActive: true, removedAt: null })],
    });

    await request(server)
      .post(
        `/api/v1/warehouses/${destinationWarehouseId}/shipments/${shipmentId}/ready-for-delivery`,
      )
      .set('Authorization', `Bearer ${destinationStaffToken}`)
      .expect(201);
    expect(await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).toMatchObject({
      status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
      currentWarehouseId: destinationWarehouseId,
    });
  });

  it('keeps warehouse trip reads scoped and has the G2/G3B1 database constraints', async () => {
    const scopedList = await request(server)
      .get('/api/v1/line-haul/trips?page=1&limit=50')
      .set('Authorization', `Bearer ${destinationStaffToken}`)
      .expect(200);
    expect(
      bodyFrom<{ items: Array<{ id: string }> }>(scopedList).data.items.some(
        (trip) => trip.id === tripId,
      ),
    ).toBe(true);
    await request(server)
      .get(`/api/v1/line-haul/trips/${tripId}`)
      .set('Authorization', `Bearer ${wrongStaffToken}`)
      .expect(403);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'LineHaulTrip_departed_timestamp_check',
        'LineHaulTrip_arrived_timestamp_check',
        'LineHaulTrip_timestamp_order_check',
        'LineHaulTrip_route_metric_snapshot_check'
      )
    `;
    expect(constraints.map((constraint) => constraint.conname).sort()).toEqual(
      [
        'LineHaulTrip_arrived_timestamp_check',
        'LineHaulTrip_departed_timestamp_check',
        'LineHaulTrip_route_metric_snapshot_check',
        'LineHaulTrip_timestamp_order_check',
      ].sort(),
    );
  });

  it('keeps READY valid with an honest Haversine snapshot when the route provider fails', async () => {
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        currentWarehouseId: originWarehouseId,
        version: { increment: 1 },
      },
    });
    const fallbackTransfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `TRF-G2-FB-${runId}`,
        shipmentId,
        fromWarehouseId: originWarehouseId,
        toWarehouseId: destinationWarehouseId,
        status: WarehouseTransferStatus.PENDING,
        clientRequestId: randomUUID(),
        createdById: originStaffId,
      },
    });
    const fallbackTripResponse = await createTrip(secondaryDriverId, secondaryVehicleId).expect(
      201,
    );
    const fallbackTripId = bodyFrom<{ id: string }>(fallbackTripResponse).data.id;
    await scheduleTrip(fallbackTripId);
    await request(server)
      .post(`/api/v1/line-haul/trips/${fallbackTripId}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: fallbackTransfer.id })
      .expect(200);

    routeCalculate.mockRejectedValueOnce(new Error('provider unavailable; apiKey=must-not-leak'));
    const response = await request(server)
      .post(`/api/v1/line-haul/trips/${fallbackTripId}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const ready = bodyFrom<TripPayload>(response).data;
    expect(ready.status).toBe(LineHaulTripStatus.READY);
    expect(ready.plannedRoute).toMatchObject({
      durationSeconds: null,
      mode: 'HAVERSINE_FALLBACK',
      provider: 'HAVERSINE',
    });
    expect(ready.plannedRoute?.distanceMeters).toBeGreaterThan(0);

    const storedTrip = await prisma.lineHaulTrip.findUniqueOrThrow({
      where: { id: fallbackTripId },
    });
    expect(storedTrip).toMatchObject({
      status: LineHaulTripStatus.READY,
      plannedDurationSeconds: null,
      routeMetricMode: 'HAVERSINE_FALLBACK',
      routeProvider: 'HAVERSINE',
    });
  });
});
