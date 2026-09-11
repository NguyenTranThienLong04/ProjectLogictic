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
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface VehiclePayload {
  id: string;
  vehicleCode: string;
  licensePlate: string;
  status: LineHaulVehicleStatus;
}

interface TripPayload {
  id: string;
  tripCode: string;
  status: LineHaulTripStatus;
  transferAssignments: Array<{
    isActive: boolean;
    warehouseTransfer: { id: string; transferCode: string };
  }>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase G1 line-haul domain and fleet foundation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken = '';
  let dispatcherToken = '';
  let customerToken = '';
  let dispatcherId = '';
  let customerId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let thirdWarehouseId = '';
  let primaryDriverId = '';
  let secondaryDriverId = '';
  let thirdDriverId = '';
  let noCapabilityDriverId = '';
  let suspendedDriverId = '';
  let inactiveDriverId = '';
  let configurableDriverId = '';
  let primaryVehicle: VehiclePayload;
  let secondaryVehicle: VehiclePayload;
  let spareVehicle: VehiclePayload;
  let maintenanceVehicle: VehiclePayload;
  let inactiveVehicle: VehiclePayload;
  let primaryTrip: TripPayload;
  let secondaryTrip: TripPayload;
  let matchingTransferId = '';
  let wrongRouteTransferId = '';
  const password = 'Password@123456';
  const runId = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const emailRunId = runId.toLowerCase();
  const emails = {
    admin: `g1-admin-${emailRunId}@example.com`,
    dispatcher: `g1-dispatcher-${emailRunId}@example.com`,
    customer: `g1-customer-${emailRunId}@example.com`,
    primaryDriver: `g1-driver-1-${emailRunId}@example.com`,
    secondaryDriver: `g1-driver-2-${emailRunId}@example.com`,
    thirdDriver: `g1-driver-3-${emailRunId}@example.com`,
    noCapabilityDriver: `g1-driver-no-cap-${emailRunId}@example.com`,
    suspendedDriver: `g1-driver-suspended-${emailRunId}@example.com`,
    inactiveDriver: `g1-driver-inactive-${emailRunId}@example.com`,
    configurableDriver: `g1-driver-config-${emailRunId}@example.com`,
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
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
            fullName: `Phase G1 ${key}`,
            passwordHash,
            role:
              key === 'admin'
                ? UserRole.ADMIN
                : key === 'dispatcher'
                  ? UserRole.DISPATCHER
                  : key === 'customer'
                    ? UserRole.CUSTOMER
                    : UserRole.DRIVER,
            status: key === 'inactiveDriver' ? UserStatus.SUSPENDED : UserStatus.ACTIVE,
          },
        }),
      ),
    );
    const usersByEmail = new Map(users.map((user) => [user.email, user]));
    dispatcherId = usersByEmail.get(emails.dispatcher)!.id;
    customerId = usersByEmail.get(emails.customer)!.id;

    const warehouses = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `G1A-${runId}`,
          name: 'Phase G1 Origin Hub',
          address: '1 Origin Street',
          city: 'Ho Chi Minh City',
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `G1B-${runId}`,
          name: 'Phase G1 Destination Hub',
          address: '2 Destination Street',
          city: 'Da Nang',
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `G1C-${runId}`,
          name: 'Phase G1 Third Hub',
          address: '3 Third Street',
          city: 'Ha Noi',
        },
      }),
    ]);
    [originWarehouseId, destinationWarehouseId, thirdWarehouseId] = warehouses.map(
      (warehouse) => warehouse.id,
    );

    const createDriver = async (
      email: string,
      suffix: string,
      capabilities: DriverCapability[],
      status: DriverStatus = DriverStatus.OFFLINE,
    ) =>
      prisma.driverProfile.create({
        data: {
          userId: usersByEmail.get(email)!.id,
          operatingWarehouseId: originWarehouseId,
          employeeCode: `G1-${suffix}-${runId}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `G1-${suffix}-${runId}`,
          capabilities,
          status,
          isOnline: false,
          isAvailable: false,
        },
      });
    const profiles = await Promise.all([
      createDriver(emails.primaryDriver, 'D1', [
        DriverCapability.PICKUP,
        DriverCapability.LINE_HAUL,
      ]),
      createDriver(emails.secondaryDriver, 'D2', [DriverCapability.LINE_HAUL]),
      createDriver(emails.thirdDriver, 'D3', [DriverCapability.LINE_HAUL]),
      createDriver(emails.noCapabilityDriver, 'DN', [
        DriverCapability.PICKUP,
        DriverCapability.DELIVERY,
      ]),
      createDriver(
        emails.suspendedDriver,
        'DS',
        [DriverCapability.LINE_HAUL],
        DriverStatus.SUSPENDED,
      ),
      createDriver(emails.inactiveDriver, 'DI', [DriverCapability.LINE_HAUL]),
      createDriver(emails.configurableDriver, 'DC', [DriverCapability.PICKUP]),
    ]);
    [
      primaryDriverId,
      secondaryDriverId,
      thirdDriverId,
      noCapabilityDriverId,
      suspendedDriverId,
      inactiveDriverId,
      configurableDriverId,
    ] = profiles.map((profile) => profile.id);

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

    const shipmentData = {
      clientRequestId: randomUUID(),
      customerId,
      senderSnapshot: { fullName: 'G1 Sender', phone: '0900000001' },
      receiverSnapshot: { fullName: 'G1 Receiver', phone: '0900000002' },
      pickupSnapshot: { city: 'Ho Chi Minh City', streetAddress: '1 Origin Street' },
      deliverySnapshot: { city: 'Da Nang', streetAddress: '2 Destination Street' },
      packageSnapshot: { description: 'G1 package', packageType: 'PARCEL', weightGrams: 1_000 },
      pricingSnapshot: { totalFee: 30_000 },
      totalFee: 30_000,
      status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
      originWarehouseId,
      currentWarehouseId: originWarehouseId,
    };
    const [matchingShipment, wrongRouteShipment] = await Promise.all([
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-G1A-${runId}`,
          destinationWarehouseId,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          clientRequestId: randomUUID(),
          trackingCode: `SHP-G1C-${runId}`,
          destinationWarehouseId: thirdWarehouseId,
        },
      }),
    ]);
    const [matchingTransfer, wrongRouteTransfer] = await Promise.all([
      prisma.warehouseTransfer.create({
        data: {
          transferCode: `TRF-G1A-${runId}`,
          shipmentId: matchingShipment.id,
          fromWarehouseId: originWarehouseId,
          toWarehouseId: destinationWarehouseId,
          status: WarehouseTransferStatus.PENDING,
          clientRequestId: randomUUID(),
          createdById: dispatcherId,
        },
      }),
      prisma.warehouseTransfer.create({
        data: {
          transferCode: `TRF-G1C-${runId}`,
          shipmentId: wrongRouteShipment.id,
          fromWarehouseId: originWarehouseId,
          toWarehouseId: thirdWarehouseId,
          status: WarehouseTransferStatus.PENDING,
          clientRequestId: randomUUID(),
          createdById: dispatcherId,
        },
      }),
    ]);
    matchingTransferId = matchingTransfer.id;
    wrongRouteTransferId = wrongRouteTransfer.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const trips = await prisma.lineHaulTrip.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const tripIds = trips.map((trip) => trip.id);
    if (tripIds.length) {
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.lineHaulTrip.updateMany({
        where: { id: { in: tripIds } },
        data: { currentRouteId: null },
      });
      await prisma.lineHaulTripRoute.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
    }
    await prisma.lineHaulVehicle.deleteMany({
      where: { vehicleCode: { startsWith: `G1V-${runId}` } },
    });
    const transfers = await prisma.warehouseTransfer.findMany({
      where: { createdById: dispatcherId },
      select: { id: true, shipmentId: true },
    });
    const transferIds = transfers.map((transfer) => transfer.id);
    const shipmentIds = transfers.map((transfer) => transfer.shipmentId);
    if (transferIds.length) {
      await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
    }
    if (shipmentIds.length) {
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.warehouse.deleteMany({
      where: { code: { in: [`G1A-${runId}`, `G1B-${runId}`, `G1C-${runId}`] } },
    });
    await app.close();
  });

  const createVehicle = async (suffix: string) => {
    const response = await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleCode: `G1V-${runId}-${suffix}`,
        licensePlate: `51C-${runId.slice(0, 5)}-${suffix}`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: 8_000_000,
      })
      .expect(201);
    return bodyFrom<VehiclePayload>(response).data;
  };

  const createTrip = (input: {
    originWarehouseId?: string;
    destinationWarehouseId?: string;
    driverId: string;
    vehicleId: string;
  }) =>
    request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        clientRequestId: randomUUID(),
        originWarehouseId: input.originWarehouseId ?? originWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId ?? destinationWarehouseId,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        plannedDepartureAt: '2026-09-04T08:00:00.000Z',
      });

  it('has additive enum, check, fleet unique and transfer-ownership constraints in PostgreSQL', async () => {
    const enumRows = await prisma.$queryRaw<Array<{ type_name: string; enum_value: string }>>`
      SELECT t.typname AS type_name, e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('DriverCapability', 'LineHaulVehicleStatus', 'LineHaulTripStatus')
    `;
    expect(enumRows).toEqual(
      expect.arrayContaining([
        { type_name: 'DriverCapability', enum_value: 'LINE_HAUL' },
        { type_name: 'LineHaulVehicleStatus', enum_value: 'MAINTENANCE' },
        { type_name: 'LineHaulTripStatus', enum_value: 'IN_TRANSIT' },
      ]),
    );
    const indexRows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'LineHaulVehicle_vehicleCode_key',
          'LineHaulVehicle_licensePlate_key',
          'LineHaulTripTransfer_active_transfer_key'
        )
    `;
    expect(indexRows.map((row) => row.indexname).sort()).toEqual(
      [
        'LineHaulTripTransfer_active_transfer_key',
        'LineHaulVehicle_licensePlate_key',
        'LineHaulVehicle_vehicleCode_key',
      ].sort(),
    );
    const constraintRows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'DriverProfile_capabilities_not_empty_check',
        'LineHaulVehicle_capacity_positive_check',
        'LineHaulTrip_distinct_warehouses_check',
        'LineHaulTripTransfer_active_history_check'
      )
    `;
    expect(constraintRows.map((row) => row.conname).sort()).toEqual(
      [
        'DriverProfile_capabilities_not_empty_check',
        'LineHaulTripTransfer_active_history_check',
        'LineHaulTrip_distinct_warehouses_check',
        'LineHaulVehicle_capacity_positive_check',
      ].sort(),
    );
  });

  it('enforces RBAC for fleet, trip and driver-capability management', async () => {
    await request(server)
      .get('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(server)
      .get('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ vehicleCode: 'NOPE', licensePlate: 'NOPE-001', vehicleType: 'TRUCK' })
      .expect(403);
    await request(server)
      .patch(`/api/v1/drivers/${configurableDriverId}/capabilities`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ capabilities: [DriverCapability.LINE_HAUL] })
      .expect(403);

    const configured = await request(server)
      .patch(`/api/v1/drivers/${configurableDriverId}/capabilities`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capabilities: [DriverCapability.PICKUP, DriverCapability.LINE_HAUL] })
      .expect(200);
    expect(bodyFrom<{ capabilities: DriverCapability[] }>(configured).data.capabilities).toEqual([
      DriverCapability.PICKUP,
      DriverCapability.LINE_HAUL,
    ]);
  });

  it('creates vehicles, normalizes identifiers and rejects duplicate code or plate', async () => {
    primaryVehicle = await createVehicle('01');
    secondaryVehicle = await createVehicle('02');
    spareVehicle = await createVehicle('03');
    maintenanceVehicle = await createVehicle('04');
    inactiveVehicle = await createVehicle('05');
    expect(primaryVehicle).toMatchObject({
      vehicleCode: `G1V-${runId}-01`,
      licensePlate: `51C-${runId.slice(0, 5)}-01`,
      status: LineHaulVehicleStatus.AVAILABLE,
    });

    await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleCode: primaryVehicle.vehicleCode.toLowerCase(),
        licensePlate: `51C-${runId.slice(0, 5)}-91`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: 8_000_000,
      })
      .expect(409);
    await request(server)
      .post('/api/v1/line-haul/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleCode: `G1V-${runId}-92`,
        licensePlate: primaryVehicle.licensePlate.toLowerCase(),
        vehicleType: 'TRUCK',
        capacityWeightGrams: 8_000_000,
      })
      .expect(409);
  });

  it('excludes maintenance/inactive vehicles and incapable/suspended/inactive drivers', async () => {
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${maintenanceVehicle.id}/mark-maintenance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${inactiveVehicle.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const vehiclesResponse = await request(server)
      .get('/api/v1/line-haul/trips/eligible-vehicles')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const eligibleVehicleIds = bodyFrom<VehiclePayload[]>(vehiclesResponse).data.map(
      (vehicle) => vehicle.id,
    );
    expect(eligibleVehicleIds).not.toContain(maintenanceVehicle.id);
    expect(eligibleVehicleIds).not.toContain(inactiveVehicle.id);

    const driversResponse = await request(server)
      .get('/api/v1/line-haul/trips/eligible-drivers')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const eligibleDriverIds = bodyFrom<Array<{ id: string }>>(driversResponse).data.map(
      (driver) => driver.id,
    );
    expect(eligibleDriverIds).not.toContain(noCapabilityDriverId);
    expect(eligibleDriverIds).not.toContain(suspendedDriverId);
    expect(eligibleDriverIds).not.toContain(inactiveDriverId);

    for (const driverId of [noCapabilityDriverId, suspendedDriverId, inactiveDriverId]) {
      await createTrip({ driverId, vehicleId: spareVehicle.id }).expect(409);
    }
    await createTrip({ driverId: thirdDriverId, vehicleId: maintenanceVehicle.id }).expect(409);
    await createTrip({ driverId: thirdDriverId, vehicleId: inactiveVehicle.id }).expect(409);
  });

  it('rejects same-warehouse routes and allows unscheduled planning without reserving resources', async () => {
    await createTrip({
      originWarehouseId,
      destinationWarehouseId: originWarehouseId,
      driverId: primaryDriverId,
      vehicleId: primaryVehicle.id,
    }).expect(400);

    const primaryResponse = await createTrip({
      driverId: primaryDriverId,
      vehicleId: primaryVehicle.id,
    }).expect(201);
    primaryTrip = bodyFrom<TripPayload>(primaryResponse).data;
    const secondaryResponse = await createTrip({
      driverId: secondaryDriverId,
      vehicleId: secondaryVehicle.id,
    }).expect(201);
    secondaryTrip = bodyFrom<TripPayload>(secondaryResponse).data;

    await createTrip({
      driverId: primaryDriverId,
      vehicleId: spareVehicle.id,
    }).expect(201);
    await createTrip({
      driverId: thirdDriverId,
      vehicleId: primaryVehicle.id,
    }).expect(201);

    const detail = await request(server)
      .get(`/api/v1/line-haul/trips/${primaryTrip.id}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(detail).data.tripCode).toMatch(/^LHT-\d{8}-[A-F0-9]{6}$/);
  });

  it('enforces transfer route and single active-trip association while preserving history', async () => {
    const wrongRoute = await request(server)
      .post(`/api/v1/line-haul/trips/${primaryTrip.id}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: wrongRouteTransferId })
      .expect(409);
    expect(wrongRoute.body).toMatchObject({ code: 'LINE_HAUL_TRANSFER_ROUTE_MISMATCH' });

    const assigned = await request(server)
      .post(`/api/v1/line-haul/trips/${primaryTrip.id}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: matchingTransferId })
      .expect(200);
    const activeAssignment = bodyFrom<TripPayload>(assigned).data.transferAssignments.find(
      (assignment) => assignment.isActive,
    );
    expect(activeAssignment?.warehouseTransfer.id).toBe(matchingTransferId);

    const ownershipConflict = await request(server)
      .post(`/api/v1/line-haul/trips/${secondaryTrip.id}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: matchingTransferId })
      .expect(409);
    expect(ownershipConflict.body).toMatchObject({ code: 'WAREHOUSE_TRANSFER_ACTIVE_TRIP' });

    const cancelled = await request(server)
      .post(`/api/v1/line-haul/trips/${primaryTrip.id}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ reason: 'Kế hoạch tuyến thay đổi' })
      .expect(200);
    expect(bodyFrom<TripPayload>(cancelled).data).toMatchObject({
      status: LineHaulTripStatus.CANCELLED,
      transferAssignments: [expect.objectContaining({ isActive: false })],
    });

    const reassigned = await request(server)
      .post(`/api/v1/line-haul/trips/${secondaryTrip.id}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: matchingTransferId })
      .expect(200);
    expect(bodyFrom<TripPayload>(reassigned).data.transferAssignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ isActive: true })]),
    );

    await request(server)
      .post(`/api/v1/line-haul/trips/${secondaryTrip.id}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ reason: 'Kết thúc kiểm thử G1' })
      .expect(200);
  });
});
