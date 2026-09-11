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

interface TripPayload {
  id: string;
  tripCode: string;
  status: LineHaulTripStatus;
  version: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  vehicle: { id: string; status: LineHaulVehicleStatus };
}

interface AvailabilityPayload {
  drivers: Array<{ id: string; availability: 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' }>;
  vehicles: Array<{ id: string; availability: 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' }>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase G3C2 line-haul scheduling and resource availability (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken = '';
  let dispatcherToken = '';
  let customerToken = '';
  let originStaffToken = '';
  let unrelatedStaffToken = '';
  let dispatcherId = '';
  let customerId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let unrelatedWarehouseId = '';
  const driverIds: string[] = [];
  const vehicleIds: string[] = [];
  const createdTripIds: string[] = [];
  const createdShipmentIds: string[] = [];
  const createdTransferIds: string[] = [];
  const password = 'Password@123456';
  const runId = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const emailRunId = runId.toLowerCase();
  const emails = {
    admin: `g3c2-admin-${emailRunId}@example.com`,
    dispatcher: `g3c2-dispatcher-${emailRunId}@example.com`,
    customer: `g3c2-customer-${emailRunId}@example.com`,
    originStaff: `g3c2-origin-staff-${emailRunId}@example.com`,
    unrelatedStaff: `g3c2-unrelated-staff-${emailRunId}@example.com`,
    drivers: Array.from(
      { length: 8 },
      (_, index) => `g3c2-driver-${index + 1}-${emailRunId}@example.com`,
    ),
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
    const userInputs = [
      { key: 'admin', email: emails.admin, role: UserRole.ADMIN },
      { key: 'dispatcher', email: emails.dispatcher, role: UserRole.DISPATCHER },
      { key: 'customer', email: emails.customer, role: UserRole.CUSTOMER },
      { key: 'originStaff', email: emails.originStaff, role: UserRole.WAREHOUSE_STAFF },
      {
        key: 'unrelatedStaff',
        email: emails.unrelatedStaff,
        role: UserRole.WAREHOUSE_STAFF,
      },
      ...emails.drivers.map((email, index) => ({
        key: `driver${index + 1}`,
        email,
        role: UserRole.DRIVER,
      })),
    ];
    const users = await Promise.all(
      userInputs.map(({ key, email, role }) =>
        prisma.user.create({
          data: {
            email,
            fullName: `Phase G3C2 ${key}`,
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
        ['A', 'Origin Hub', 'Ho Chi Minh City'],
        ['B', 'Destination Hub', 'Da Nang'],
        ['C', 'Unrelated Hub', 'Ha Noi'],
      ].map(([suffix, name, city]) =>
        prisma.warehouse.create({
          data: {
            code: `G3C2-${suffix}-${runId}`,
            name: `Phase G3C2 ${name}`,
            address: `${suffix} Scheduling Street`,
            city,
          },
        }),
      ),
    );
    [originWarehouseId, destinationWarehouseId, unrelatedWarehouseId] = warehouses.map(
      ({ id }) => id,
    );
    await Promise.all([
      prisma.warehouseStaffProfile.create({
        data: {
          userId: usersByEmail.get(emails.originStaff)!.id,
          warehouseId: originWarehouseId,
          staffCode: `G3C2-STA-${runId}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: usersByEmail.get(emails.unrelatedStaff)!.id,
          warehouseId: unrelatedWarehouseId,
          staffCode: `G3C2-STC-${runId}`,
        },
      }),
    ]);

    const profiles = await Promise.all(
      emails.drivers.map((email, index) =>
        prisma.driverProfile.create({
          data: {
            userId: usersByEmail.get(email)!.id,
            operatingWarehouseId: originWarehouseId,
            employeeCode: `G3C2-D${index + 1}-${runId}`,
            vehicleType: 'TRUCK',
            vehiclePlate: `G3C2-D${index + 1}-${runId}`,
            capabilities: [DriverCapability.LINE_HAUL],
            status: DriverStatus.OFFLINE,
          },
        }),
      ),
    );
    driverIds.push(...profiles.map(({ id }) => id));
    const vehicles = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        prisma.lineHaulVehicle.create({
          data: {
            vehicleCode: `G3C2-V${index + 1}-${runId}`,
            licensePlate: `G3C2-${runId.slice(0, 6)}-${index + 1}`,
            vehicleType: 'TRUCK',
            capacityWeightGrams: 8_000_000,
          },
        }),
      ),
    );
    vehicleIds.push(...vehicles.map(({ id }) => id));

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [adminToken, dispatcherToken, customerToken, originStaffToken, unrelatedStaffToken] =
      await Promise.all([
        login(emails.admin),
        login(emails.dispatcher),
        login(emails.customer),
        login(emails.originStaff),
        login(emails.unrelatedStaff),
      ]);
  });

  afterAll(async () => {
    if (!prisma) return;
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            emails.admin,
            emails.dispatcher,
            emails.customer,
            emails.originStaff,
            emails.unrelatedStaff,
            ...emails.drivers,
          ],
        },
      },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    if (createdTripIds.length > 0) {
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: createdTripIds } } });
      await prisma.lineHaulTrip.updateMany({
        where: { id: { in: createdTripIds } },
        data: { currentRouteId: null },
      });
      await prisma.lineHaulTripRoute.deleteMany({ where: { tripId: { in: createdTripIds } } });
      await prisma.lineHaulTrip.deleteMany({ where: { id: { in: createdTripIds } } });
    }
    if (createdShipmentIds.length > 0) {
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
    }
    if (createdTransferIds.length > 0) {
      await prisma.warehouseTransfer.deleteMany({ where: { id: { in: createdTransferIds } } });
    }
    if (createdShipmentIds.length > 0) {
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: createdShipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.lineHaulVehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    await prisma.warehouse.deleteMany({
      where: { id: { in: [originWarehouseId, destinationWarehouseId, unrelatedWarehouseId] } },
    });
    await app.close();
  });

  const createTrip = async (driverId: string, vehicleId: string) => {
    const response = await request(server)
      .post('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        clientRequestId: randomUUID(),
        originWarehouseId,
        destinationWarehouseId,
        driverId,
        vehicleId,
      })
      .expect(201);
    const trip = bodyFrom<TripPayload>(response).data;
    createdTripIds.push(trip.id);
    return trip;
  };

  const scheduleTrip = (
    trip: TripPayload,
    scheduledStartAt: string,
    scheduledEndAt: string,
    command: 'schedule' | 'reschedule' = 'schedule',
  ) =>
    request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/${command}`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ expectedVersion: trip.version, scheduledStartAt, scheduledEndAt });

  it('has additive window columns, a range check, and driver/vehicle exclusion constraints', async () => {
    const constraints = await prisma.$queryRaw<Array<{ conname: string; contype: string }>>`
      SELECT conname, contype::text AS contype
      FROM pg_constraint
      WHERE conname IN (
        'LineHaulTrip_schedule_window_check',
        'LineHaulTrip_driver_schedule_excl',
        'LineHaulTrip_vehicle_schedule_excl'
      )
    `;
    expect(constraints).toEqual(
      expect.arrayContaining([
        { conname: 'LineHaulTrip_schedule_window_check', contype: 'c' },
        { conname: 'LineHaulTrip_driver_schedule_excl', contype: 'x' },
        { conname: 'LineHaulTrip_vehicle_schedule_excl', contype: 'x' },
      ]),
    );
  });

  it('rejects overlap, accepts non-overlap and adjacent windows, and exposes availability', async () => {
    const primary = await createTrip(driverIds[0], vehicleIds[0]);
    const primarySchedule = await scheduleTrip(
      primary,
      '2026-10-01T03:00:00.000Z',
      '2026-10-01T05:00:00.000Z',
    ).expect(200);
    const scheduledPrimary = bodyFrom<TripPayload>(primarySchedule).data;
    expect(scheduledPrimary.vehicle.status).toBe(LineHaulVehicleStatus.AVAILABLE);

    const adjacentDriver = await createTrip(driverIds[0], vehicleIds[1]);
    await scheduleTrip(
      adjacentDriver,
      '2026-10-01T05:00:00.000Z',
      '2026-10-01T07:00:00.000Z',
    ).expect(200);
    const adjacentVehicle = await createTrip(driverIds[1], vehicleIds[0]);
    await scheduleTrip(
      adjacentVehicle,
      '2026-10-01T01:00:00.000Z',
      '2026-10-01T03:00:00.000Z',
    ).expect(200);
    const nonOverlapping = await createTrip(driverIds[0], vehicleIds[3]);
    await scheduleTrip(
      nonOverlapping,
      '2026-10-01T08:00:00.000Z',
      '2026-10-01T10:00:00.000Z',
    ).expect(200);

    const overlappingDriver = await createTrip(driverIds[0], vehicleIds[2]);
    const driverConflict = await scheduleTrip(
      overlappingDriver,
      '2026-10-01T04:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ).expect(409);
    expect(driverConflict.body).toMatchObject({ code: 'LINE_HAUL_DRIVER_SCHEDULE_CONFLICT' });
    const overlappingVehicle = await createTrip(driverIds[2], vehicleIds[0]);
    const vehicleConflict = await scheduleTrip(
      overlappingVehicle,
      '2026-10-01T04:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ).expect(409);
    expect(vehicleConflict.body).toMatchObject({ code: 'LINE_HAUL_VEHICLE_SCHEDULE_CONFLICT' });

    await scheduleTrip(primary, '2026-10-01T05:00:00.000Z', '2026-10-01T05:00:00.000Z').expect(400);
    const availabilityResponse = await request(server)
      .get('/api/v1/line-haul/trips/resource-availability')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .query({
        scheduledStartAt: '2026-10-01T04:00:00.000Z',
        scheduledEndAt: '2026-10-01T05:00:00.000Z',
      })
      .expect(200);
    const availability = bodyFrom<AvailabilityPayload>(availabilityResponse).data;
    expect(availability.drivers.find(({ id }) => id === driverIds[0])?.availability).toBe('BUSY');
    expect(availability.vehicles.find(({ id }) => id === vehicleIds[0])?.availability).toBe('BUSY');
    expect(availability.drivers.find(({ id }) => id === driverIds[3])?.availability).toBe(
      'AVAILABLE',
    );
  });

  it('serializes concurrent reservations so exactly one overlapping request succeeds', async () => {
    const left = await createTrip(driverIds[3], vehicleIds[3]);
    const right = await createTrip(driverIds[3], vehicleIds[3]);
    const responses = await Promise.all([
      scheduleTrip(left, '2026-10-02T03:00:00.000Z', '2026-10-02T05:00:00.000Z'),
      scheduleTrip(right, '2026-10-02T03:00:00.000Z', '2026-10-02T05:00:00.000Z'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const committed = await prisma.lineHaulTrip.count({
      where: {
        id: { in: [left.id, right.id] },
        scheduledStartAt: { not: null },
        scheduledEndAt: { not: null },
      },
    });
    expect(committed).toBe(1);
  });

  it('allows only one concurrent reschedule and rejects a stale conflicting move', async () => {
    const target = await createTrip(driverIds[4], vehicleIds[5]);
    const first = bodyFrom<TripPayload>(
      await scheduleTrip(target, '2026-10-03T03:00:00.000Z', '2026-10-03T05:00:00.000Z').expect(
        200,
      ),
    ).data;
    const responses = await Promise.all([
      scheduleTrip(first, '2026-10-03T05:00:00.000Z', '2026-10-03T07:00:00.000Z', 'reschedule'),
      scheduleTrip(first, '2026-10-03T07:00:00.000Z', '2026-10-03T09:00:00.000Z', 'reschedule'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const winner = bodyFrom<TripPayload>(responses.find(({ status }) => status === 200)!).data;
    const conflicting = await createTrip(driverIds[4], vehicleIds[6]);
    const conflict = await scheduleTrip(
      conflicting,
      winner.scheduledStartAt!,
      winner.scheduledEndAt!,
    ).expect(409);
    expect(conflict.body).toMatchObject({ code: 'LINE_HAUL_DRIVER_SCHEDULE_CONFLICT' });
  });

  it('audits schedule, reschedule, and unschedule without changing vehicle IN_USE state', async () => {
    const trip = await createTrip(driverIds[5], vehicleIds[6]);
    const scheduled = bodyFrom<TripPayload>(
      await scheduleTrip(trip, '2026-10-04T03:00:00.000Z', '2026-10-04T05:00:00.000Z').expect(200),
    ).data;
    const rescheduled = bodyFrom<TripPayload>(
      await scheduleTrip(
        scheduled,
        '2026-10-04T05:00:00.000Z',
        '2026-10-04T07:00:00.000Z',
        'reschedule',
      ).expect(200),
    ).data;
    const unscheduledResponse = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/unschedule`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ expectedVersion: rescheduled.version })
      .expect(200);
    expect(bodyFrom<TripPayload>(unscheduledResponse).data).toMatchObject({
      scheduledStartAt: null,
      scheduledEndAt: null,
      vehicle: { status: LineHaulVehicleStatus.AVAILABLE },
    });
    const audits = await prisma.auditLog.findMany({
      where: {
        entityType: 'LineHaulTrip',
        entityId: trip.id,
        action: {
          in: [
            'LINE_HAUL_TRIP_SCHEDULED',
            'LINE_HAUL_TRIP_RESCHEDULED',
            'LINE_HAUL_TRIP_UNSCHEDULED',
          ],
        },
      },
      select: { action: true },
    });
    expect(audits.map(({ action }) => action).sort()).toEqual(
      [
        'LINE_HAUL_TRIP_RESCHEDULED',
        'LINE_HAUL_TRIP_SCHEDULED',
        'LINE_HAUL_TRIP_UNSCHEDULED',
      ].sort(),
    );
  });

  it('revalidates missing schedule, suspended driver, maintenance vehicle, and dispatch state', async () => {
    const trip = await createTrip(driverIds[6], vehicleIds[7]);
    const shipment = await prisma.shipment.create({
      data: {
        clientRequestId: randomUUID(),
        trackingCode: `SHP-G3C2-${runId}`,
        customerId,
        senderSnapshot: { fullName: 'G3C2 Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'G3C2 Receiver', phone: '0900000002' },
        pickupSnapshot: { city: 'Ho Chi Minh City', streetAddress: '1 Origin Street' },
        deliverySnapshot: { city: 'Da Nang', streetAddress: '2 Destination Street' },
        packageSnapshot: {
          description: 'G3C2 package',
          packageType: 'PARCEL',
          weightGrams: 1_000,
          verifiedWeightGrams: 1_000,
        },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId,
        destinationWarehouseId,
        currentWarehouseId: originWarehouseId,
      },
    });
    createdShipmentIds.push(shipment.id);
    const transfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `TRF-G3C2-${runId}`,
        shipmentId: shipment.id,
        fromWarehouseId: originWarehouseId,
        toWarehouseId: destinationWarehouseId,
        status: WarehouseTransferStatus.PENDING,
        clientRequestId: randomUUID(),
        createdById: dispatcherId,
      },
    });
    createdTransferIds.push(transfer.id);
    await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/transfers`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ transferId: transfer.id })
      .expect(200);
    const missingSchedule = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    expect(missingSchedule.body).toMatchObject({ code: 'LINE_HAUL_SCHEDULE_REQUIRED' });

    const scheduled = bodyFrom<TripPayload>(
      await scheduleTrip(trip, '2026-10-05T03:00:00.000Z', '2026-10-05T05:00:00.000Z').expect(200),
    ).data;
    await request(server)
      .patch(`/api/v1/drivers/${driverIds[6]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ suspended: true })
      .expect(200);
    const suspended = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    expect(suspended.body).toMatchObject({ code: 'LINE_HAUL_DRIVER_INACTIVE' });
    await request(server)
      .patch(`/api/v1/drivers/${driverIds[6]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ suspended: false })
      .expect(200);

    await request(server)
      .post(`/api/v1/line-haul/vehicles/${vehicleIds[7]}/mark-maintenance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const maintenance = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    expect(maintenance.body).toMatchObject({ code: 'LINE_HAUL_VEHICLE_NOT_AVAILABLE' });
    await request(server)
      .post(`/api/v1/line-haul/vehicles/${vehicleIds[7]}/activate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const readyResponse = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/prepare`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const ready = bodyFrom<TripPayload>(readyResponse).data;
    expect(ready).toMatchObject({
      status: LineHaulTripStatus.READY,
      vehicle: { status: LineHaulVehicleStatus.AVAILABLE },
    });
    await scheduleTrip(
      ready,
      '2026-10-05T05:00:00.000Z',
      '2026-10-05T07:00:00.000Z',
      'reschedule',
    ).expect(409);
    await prisma.lineHaulVehicle.update({
      where: { id: vehicleIds[7] },
      data: { status: LineHaulVehicleStatus.MAINTENANCE },
    });
    await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(409);
    await prisma.lineHaulVehicle.update({
      where: { id: vehicleIds[7] },
      data: { status: LineHaulVehicleStatus.AVAILABLE },
    });
    const dispatchedResponse = await request(server)
      .post(`/api/v1/line-haul/trips/${trip.id}/dispatch`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<TripPayload>(dispatchedResponse).data).toMatchObject({
      status: LineHaulTripStatus.IN_TRANSIT,
      vehicle: { status: LineHaulVehicleStatus.IN_USE },
    });
    expect(scheduled.scheduledStartAt).not.toBeNull();
  });

  it('enforces command RBAC and warehouse-scoped schedule-board reads', async () => {
    const scopedTrip = await createTrip(driverIds[7], vehicleIds[2]);
    await scheduleTrip(scopedTrip, '2026-10-06T03:00:00.000Z', '2026-10-06T05:00:00.000Z').expect(
      200,
    );
    await request(server)
      .post(`/api/v1/line-haul/trips/${scopedTrip.id}/unschedule`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ expectedVersion: 1 })
      .expect(403);
    await request(server)
      .post(`/api/v1/line-haul/trips/${scopedTrip.id}/reschedule`)
      .set('Authorization', `Bearer ${originStaffToken}`)
      .send({
        expectedVersion: 1,
        scheduledStartAt: '2026-10-06T05:00:00.000Z',
        scheduledEndAt: '2026-10-06T07:00:00.000Z',
      })
      .expect(403);
    await request(server)
      .get('/api/v1/line-haul/trips/resource-availability')
      .set('Authorization', `Bearer ${originStaffToken}`)
      .query({
        scheduledStartAt: '2026-10-06T03:00:00.000Z',
        scheduledEndAt: '2026-10-06T05:00:00.000Z',
      })
      .expect(403);

    const query = {
      search: scopedTrip.tripCode,
      scheduledFrom: '2026-10-06T00:00:00.000Z',
      scheduledTo: '2026-10-07T00:00:00.000Z',
      page: 1,
      limit: 20,
    };
    const originList = await request(server)
      .get('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${originStaffToken}`)
      .query(query)
      .expect(200);
    expect(bodyFrom<{ items: TripPayload[] }>(originList).data.items).toHaveLength(1);
    const unrelatedList = await request(server)
      .get('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${unrelatedStaffToken}`)
      .query(query)
      .expect(200);
    expect(bodyFrom<{ items: TripPayload[] }>(unrelatedList).data.items).toHaveLength(0);
    await request(server)
      .get(`/api/v1/line-haul/trips/${scopedTrip.id}`)
      .set('Authorization', `Bearer ${unrelatedStaffToken}`)
      .expect(403);
    const adminList = await request(server)
      .get('/api/v1/line-haul/trips')
      .set('Authorization', `Bearer ${adminToken}`)
      .query(query)
      .expect(200);
    expect(bodyFrom<{ items: TripPayload[] }>(adminList).data.items).toHaveLength(1);
  });
});
