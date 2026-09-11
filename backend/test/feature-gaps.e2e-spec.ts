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
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface Paginated<T> {
  items: T[];
  page: number;
  total: number;
  totalPages: number;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Feature gap dashboards and operational reads (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken = '';
  let dispatcherToken = '';
  let customerToken = '';
  let driverToken = '';
  let otherDriverToken = '';
  let warehouseToken = '';
  let customerTwoId = '';
  let driverProfileId = '';
  let pickupAssignmentId = '';
  let deliveryHistoryAssignmentId = '';
  let otherDriverAssignmentId = '';
  let warehouseOneId = '';
  let warehouseTwoId = '';
  let currentDriverLocation: string | null = null;
  const shipmentIds: string[] = [];
  const runId = randomUUID().replaceAll('-', '');
  const password = 'Password@123456';
  const emails = {
    admin: `admin-gap-${runId}@example.com`,
    dispatcher: `dispatcher-gap-${runId}@example.com`,
    customer: `customer-gap-${runId}@example.com`,
    customerTwo: `customer-two-gap-${runId}@example.com`,
    driver: `driver-gap-${runId}@example.com`,
    otherDriver: `other-driver-gap-${runId}@example.com`,
    warehouse: `warehouse-gap-${runId}@example.com`,
    otherWarehouse: `other-warehouse-gap-${runId}@example.com`,
  };
  const redisClient = {
    status: 'ready',
    get: jest.fn((key: string) =>
      Promise.resolve(key === `driver:location:${driverProfileId}` ? currentDriverLocation : null),
    ),
    set: jest.fn(),
    del: jest.fn(),
    mget: jest.fn(),
    quit: jest.fn(),
  };
  const mockRedisService = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getClient: jest.fn(() => redisClient),
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
    const userSeeds: Array<[string, string, UserRole]> = [
      [emails.admin, 'Gap Admin', UserRole.ADMIN],
      [emails.dispatcher, 'Gap Dispatcher', UserRole.DISPATCHER],
      [emails.customer, 'Gap Customer', UserRole.CUSTOMER],
      [emails.customerTwo, 'Gap Customer Two', UserRole.CUSTOMER],
      [emails.driver, 'Gap Driver', UserRole.DRIVER],
      [emails.otherDriver, 'Gap Other Driver', UserRole.DRIVER],
      [emails.warehouse, 'Gap Warehouse', UserRole.WAREHOUSE_STAFF],
      [emails.otherWarehouse, 'Gap Other Warehouse', UserRole.WAREHOUSE_STAFF],
    ];
    const [, dispatcher, customer, customerTwo, driver, otherDriver, warehouse, otherWarehouse] =
      await Promise.all(
        userSeeds.map(([email, fullName, role]) =>
          prisma.user.create({
            data: {
              email: email,
              fullName: fullName,
              passwordHash,
              role,
            },
          }),
        ),
      );
    customerTwoId = customerTwo.id;

    const [warehouseOne, warehouseTwo] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `GAP1-${runId.slice(0, 8).toUpperCase()}`,
          name: 'Feature Gap Warehouse One',
          address: '1 Gap Street',
          ward: 'Ward 1',
          district: 'District 4',
          city: 'Ho Chi Minh City',
          latitude: 10.755,
          longitude: 106.705,
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `GAP2-${runId.slice(0, 8).toUpperCase()}`,
          name: 'Feature Gap Warehouse Two',
          address: '2 Gap Street',
          ward: 'Hai Chau 1',
          district: 'Hai Chau',
          city: 'Da Nang',
          latitude: 16.0678,
          longitude: 108.2208,
        },
      }),
    ]);
    warehouseOneId = warehouseOne.id;
    warehouseTwoId = warehouseTwo.id;

    await Promise.all([
      prisma.warehouseStaffProfile.create({
        data: {
          userId: warehouse.id,
          warehouseId: warehouseOne.id,
          staffCode: `WHS1-${runId.slice(0, 9).toUpperCase()}`,
        },
      }),
      prisma.warehouseStaffProfile.create({
        data: {
          userId: otherWarehouse.id,
          warehouseId: warehouseTwo.id,
          staffCode: `WHS2-${runId.slice(0, 9).toUpperCase()}`,
        },
      }),
    ]);

    const [driverProfile, otherDriverProfile] = await Promise.all([
      prisma.driverProfile.create({
        data: {
          userId: driver.id,
          employeeCode: `DRV1-${runId.slice(0, 9).toUpperCase()}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `59G1-${runId.slice(0, 5).toUpperCase()}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      }),
      prisma.driverProfile.create({
        data: {
          userId: otherDriver.id,
          employeeCode: `DRV2-${runId.slice(0, 9).toUpperCase()}`,
          vehicleType: 'VAN',
          vehiclePlate: `59G2-${runId.slice(0, 5).toUpperCase()}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      }),
    ]);
    driverProfileId = driverProfile.id;

    const shipmentData = {
      senderSnapshot: { fullName: 'Gap Sender', phone: '0900000001' },
      receiverSnapshot: { fullName: 'Gap Receiver', phone: '0900000002' },
      pickupSnapshot: {
        contactName: 'Gap Sender',
        phone: '0900000001',
        streetAddress: '1 Pickup Street',
        ward: 'Ben Nghe',
        district: 'District 1',
        city: 'Ho Chi Minh City',
        latitude: 10.7769,
        longitude: 106.7009,
      },
      deliverySnapshot: {
        contactName: 'Gap Receiver',
        phone: '0900000002',
        streetAddress: '2 Delivery Street',
        ward: 'Hai Chau 1',
        district: 'Hai Chau',
        city: 'Da Nang',
        latitude: 16.0544,
        longitude: 108.2022,
      },
      packageSnapshot: {
        description: 'Feature gap parcel',
        packageType: 'PARCEL',
        weightGrams: 800,
      },
      pricingSnapshot: { totalFee: 30_000, codAmount: 0 },
      totalFee: 30_000,
      shippingFeeTransaction: { create: { payer: 'SENDER' as const, expectedAmount: 30_000 } },
    };
    const [damaged, lost, pickup, delivered, otherDelivery] = await Promise.all([
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-GD-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customer.id,
          status: ShipmentStatus.DAMAGED,
          currentWarehouseId: warehouseOne.id,
          originWarehouseId: warehouseOne.id,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-GL-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customerTwo.id,
          status: ShipmentStatus.LOST,
          currentWarehouseId: warehouseTwo.id,
          destinationWarehouseId: warehouseTwo.id,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-GP-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customer.id,
          status: ShipmentStatus.PICKUP_ASSIGNED,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-GH-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customer.id,
          status: ShipmentStatus.DELIVERED,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-GO-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customerTwo.id,
          status: ShipmentStatus.DELIVERY_ASSIGNED,
          destinationWarehouseId: warehouseTwo.id,
        },
      }),
    ]);
    shipmentIds.push(damaged.id, lost.id, pickup.id, delivered.id, otherDelivery.id);

    const [pickupAssignment, deliveryHistoryAssignment, otherDriverAssignment] = await Promise.all([
      prisma.driverAssignment.create({
        data: {
          shipmentId: pickup.id,
          driverId: driverProfile.id,
          type: DriverAssignmentType.PICKUP,
          status: DriverAssignmentStatus.PENDING,
          clientRequestId: randomUUID(),
          assignedById: dispatcher.id,
        },
      }),
      prisma.driverAssignment.create({
        data: {
          shipmentId: delivered.id,
          driverId: driverProfile.id,
          type: DriverAssignmentType.DELIVERY,
          status: DriverAssignmentStatus.COMPLETED,
          clientRequestId: randomUUID(),
          assignedById: dispatcher.id,
          acceptedAt: new Date(Date.now() - 60 * 60 * 1000),
          completedAt: new Date(),
        },
      }),
      prisma.driverAssignment.create({
        data: {
          shipmentId: otherDelivery.id,
          driverId: otherDriverProfile.id,
          type: DriverAssignmentType.DELIVERY,
          status: DriverAssignmentStatus.PENDING,
          clientRequestId: randomUUID(),
          assignedById: dispatcher.id,
        },
      }),
    ]);
    pickupAssignmentId = pickupAssignment.id;
    deliveryHistoryAssignmentId = deliveryHistoryAssignment.id;
    otherDriverAssignmentId = otherDriverAssignment.id;

    const login = async (email: string): Promise<string> => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [adminToken, dispatcherToken, customerToken, driverToken, otherDriverToken, warehouseToken] =
      await Promise.all([
        login(emails.admin),
        login(emails.dispatcher),
        login(emails.customer),
        login(emails.driver),
        login(emails.otherDriver),
        login(emails.warehouse),
      ]);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseOneId, warehouseTwoId] } } });
    await app.close();
  });

  it('returns customer and driver dashboards only from their owned records', async () => {
    const customerResponse = await request(server)
      .get('/api/v1/dashboards/customer')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const customerDashboard = bodyFrom<{
      overview: { totalShipments: number };
      recentShipments: Array<{ id: string }>;
    }>(customerResponse).data;
    expect(customerDashboard.overview.totalShipments).toBe(3);
    expect(customerDashboard.recentShipments).toHaveLength(3);
    expect(
      customerDashboard.recentShipments.every((shipment) => shipmentIds.includes(shipment.id)),
    ).toBe(true);

    const driverResponse = await request(server)
      .get('/api/v1/dashboards/driver')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    const driverDashboard = bodyFrom<{
      driver: { id: string };
      assignments: { pending: number; completed: number };
      recentTasks: Array<{ assignmentId: string }>;
    }>(driverResponse).data;
    expect(driverDashboard.driver.id).toBe(driverProfileId);
    expect(driverDashboard.assignments).toMatchObject({ pending: 1, completed: 1 });
    expect(driverDashboard.recentTasks.map((task) => task.assignmentId)).toEqual(
      expect.arrayContaining([pickupAssignmentId, deliveryHistoryAssignmentId]),
    );

    await request(server)
      .get('/api/v1/dashboards/dispatcher')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('enforces driver detail ownership and exposes paginated history plus the own map location', async () => {
    const pickupDetailResponse = await request(server)
      .get(`/api/v1/driver/assignments/${pickupAssignmentId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(
      bodyFrom<{
        taskLocation: {
          kind: string;
          latitude: number | null;
          longitude: number | null;
        };
      }>(pickupDetailResponse).data.taskLocation,
    ).toMatchObject({
      kind: 'PICKUP',
      latitude: 10.7769,
      longitude: 106.7009,
    });
    await request(server)
      .get(`/api/v1/driver/assignments/${pickupAssignmentId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    await request(server)
      .get(`/api/v1/driver/delivery-assignments/${otherDriverAssignmentId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(404);

    const warehouseTargetResponse = await request(server)
      .get(`/api/v1/driver/delivery-assignments/${otherDriverAssignmentId}`)
      .set('Authorization', `Bearer ${otherDriverToken}`)
      .expect(200);
    const warehouseTarget = bodyFrom<{
      delivery: Record<string, unknown>;
      taskLocation: {
        kind: string;
        latitude: number | null;
        longitude: number | null;
      };
    }>(warehouseTargetResponse).data;
    expect(warehouseTarget.taskLocation).toMatchObject({
      kind: 'DESTINATION_WAREHOUSE',
      latitude: 16.0678,
      longitude: 108.2208,
    });
    expect(warehouseTarget.delivery).not.toHaveProperty('latitude');
    expect(warehouseTarget.delivery).not.toHaveProperty('longitude');

    const receiverTargetResponse = await request(server)
      .post(`/api/v1/driver/delivery-assignments/${otherDriverAssignmentId}/start`)
      .set('Authorization', `Bearer ${otherDriverToken}`)
      .expect(200);
    expect(
      bodyFrom<{
        taskLocation: {
          kind: string;
          latitude: number | null;
          longitude: number | null;
        };
      }>(receiverTargetResponse).data.taskLocation,
    ).toMatchObject({
      kind: 'RECEIVER',
      latitude: 16.0544,
      longitude: 108.2022,
    });

    const otherDriverLocationResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${otherDriverToken}`)
      .expect(200);
    expect(bodyFrom<unknown>(otherDriverLocationResponse).data).toBeNull();

    const historyResponse = await request(server)
      .get('/api/v1/driver/delivery-assignments')
      .query({ view: 'HISTORY', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    const history = bodyFrom<Paginated<{ id: string }>>(historyResponse).data;
    expect(history.items.map((assignment) => assignment.id)).toContain(deliveryHistoryAssignmentId);
    expect(history.page).toBe(1);

    currentDriverLocation = JSON.stringify({
      driverId: driverProfileId,
      latitude: 10.7769,
      longitude: 106.7009,
      updatedAt: new Date().toISOString(),
    });
    const mapResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(bodyFrom<{ driverId: string }>(mapResponse).data.driverId).toBe(driverProfileId);

    currentDriverLocation = null;
    const noLocationResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(bodyFrom<unknown>(noLocationResponse).data).toBeNull();

    currentDriverLocation = JSON.stringify({
      driverId: driverProfileId,
      latitude: 10.7769,
      longitude: 106.7009,
      updatedAt: new Date(Date.now() - 20_001).toISOString(),
    });
    const staleLocationResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(bodyFrom<unknown>(staleLocationResponse).data).toBeNull();

    redisClient.get.mockRejectedValueOnce(new Error('Connection is closed'));
    const redisUnavailableResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(bodyFrom<unknown>(redisUnavailableResponse).data).toBeNull();
    currentDriverLocation = null;
  });

  it('keeps warehouse exceptions scoped while dispatcher full views remain operationally complete', async () => {
    const warehouseResponse = await request(server)
      .get(`/api/v1/warehouses/${warehouseOneId}/exceptions`)
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(200);
    const warehouseExceptions =
      bodyFrom<Paginated<{ id: string; status: ShipmentStatus }>>(warehouseResponse).data;
    expect(warehouseExceptions.items).toHaveLength(1);
    expect(warehouseExceptions.items[0]).toMatchObject({
      id: shipmentIds[0],
      status: ShipmentStatus.DAMAGED,
    });

    await request(server)
      .get(`/api/v1/warehouses/${warehouseTwoId}/exceptions`)
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(403);

    const dispatcherResponse = await request(server)
      .get('/api/v1/dispatcher/shipments')
      .query({ view: 'EXCEPTIONS', page: 1, limit: 50 })
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const exceptions = bodyFrom<Paginated<{ id: string }>>(dispatcherResponse).data;
    expect(exceptions.items.map((shipment) => shipment.id)).toEqual(
      expect.arrayContaining([shipmentIds[0], shipmentIds[1]]),
    );

    const allResponse = await request(server)
      .get('/api/v1/dispatcher/shipments')
      .query({ view: 'ALL', search: `SHP-GP-${runId.slice(0, 10).toUpperCase()}` })
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    expect(bodyFrom<Paginated<{ id: string }>>(allResponse).data.items[0]?.id).toBe(shipmentIds[2]);
  });

  it('restricts user management and audit history to admins and writes the suspension audit', async () => {
    const usersResponse = await request(server)
      .get('/api/v1/users')
      .query({ search: emails.customerTwo, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const users = bodyFrom<Paginated<{ id: string; email: string }>>(usersResponse).data;
    expect(users.items).toEqual([
      expect.objectContaining({ id: customerTwoId, email: emails.customerTwo }),
    ]);

    await request(server)
      .patch(`/api/v1/users/${customerTwoId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: UserStatus.SUSPENDED })
      .expect(200);

    const auditResponse = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ action: 'USER_SUSPEND', page: 1, limit: 10 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const logs = bodyFrom<Paginated<{ action: string; entityId: string }>>(auditResponse).data;
    expect(logs.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'USER_SUSPEND', entityId: customerTwoId }),
      ]),
    );

    await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(server)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(403);
  });
});
