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

jest.setTimeout(120_000);

const mockLocationValues = new Map<string, string>();
const mockRedisService = {
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
  getClient: jest.fn().mockReturnValue({
    status: 'ready',
    get: jest.fn((key: string) => Promise.resolve(mockLocationValues.get(key) ?? null)),
    mget: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((key) => mockLocationValues.get(key) ?? null)),
    ),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
  }),
};

interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase 5 Last-Mile return workflow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let hasher: PasswordHasherService;
  const runId = randomUUID().replaceAll('-', '');

  const dispatcherEmail = `dispatcher-p5-${runId}@example.com`;
  const driverEmail = `driver-p5-${runId}@example.com`;
  const otherDriverEmail = `other-driver-p5-${runId}@example.com`;
  const returnStaffEmail = `return-staff-p5-${runId}@example.com`;
  const wrongStaffEmail = `wrong-staff-p5-${runId}@example.com`;
  const customerEmail = `customer-p5-${runId}@example.com`;
  const emails = [
    dispatcherEmail,
    driverEmail,
    otherDriverEmail,
    returnStaffEmail,
    wrongStaffEmail,
    customerEmail,
  ];

  let dispatcherToken = '';
  let driverToken = '';
  let otherDriverToken = '';
  let returnStaffToken = '';
  let wrongStaffToken = '';
  let driverProfileId = '';
  let shipmentId = '';
  let returnWarehouseId = '';
  let wrongWarehouseId = '';

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
    hasher = app.get(PasswordHasherService);

    const passwordHash = await hasher.hash('Password@123456');
    const [, driver, otherDriver, returnStaff, wrongStaff, customer] = await Promise.all([
      prisma.user.create({
        data: {
          email: dispatcherEmail,
          fullName: 'Dispatcher Phase 5',
          passwordHash,
          role: UserRole.DISPATCHER,
        },
      }),
      prisma.user.create({
        data: {
          email: driverEmail,
          fullName: 'Delivery Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
      prisma.user.create({
        data: {
          email: otherDriverEmail,
          fullName: 'Other Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
      prisma.user.create({
        data: {
          email: returnStaffEmail,
          fullName: 'Return Staff',
          passwordHash,
          role: UserRole.WAREHOUSE_STAFF,
        },
      }),
      prisma.user.create({
        data: {
          email: wrongStaffEmail,
          fullName: 'Wrong Warehouse Staff',
          passwordHash,
          role: UserRole.WAREHOUSE_STAFF,
        },
      }),
      prisma.user.create({
        data: {
          email: customerEmail,
          fullName: 'Customer Phase 5',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
    ]);

    const [returnWarehouse, wrongWarehouse] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `WH-RET-${runId.slice(0, 12).toUpperCase()}`,
          name: 'Phase 5 Return Warehouse',
          address: '100 Return Street',
          city: 'Ho Chi Minh City',
          latitude: 10.7769,
          longitude: 106.7009,
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `WH-WRG-${runId.slice(0, 12).toUpperCase()}`,
          name: 'Phase 5 Wrong Warehouse',
          address: '200 Wrong Street',
          city: 'Ha Noi',
          latitude: 21.0285,
          longitude: 105.8542,
        },
      }),
    ]);
    returnWarehouseId = returnWarehouse.id;
    wrongWarehouseId = wrongWarehouse.id;

    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driver.id,
        operatingWarehouseId: returnWarehouse.id,
        employeeCode: `DRV-P5-${runId.slice(0, 12).toUpperCase()}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `59P5-${runId.slice(0, 5).toUpperCase()}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    });
    driverProfileId = driverProfile.id;
    mockLocationValues.set(
      `driver:location:${driverProfile.id}`,
      JSON.stringify({
        driverId: driverProfile.id,
        latitude: 10.777,
        longitude: 106.701,
        updatedAt: new Date().toISOString(),
      }),
    );
    await prisma.driverProfile.create({
      data: {
        userId: otherDriver.id,
        operatingWarehouseId: wrongWarehouse.id,
        employeeCode: `DRV-P5-O-${runId.slice(0, 10).toUpperCase()}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `59P9-${runId.slice(0, 5).toUpperCase()}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    });
    await prisma.warehouseStaffProfile.createMany({
      data: [
        {
          userId: returnStaff.id,
          warehouseId: returnWarehouse.id,
          staffCode: `RET-${runId.slice(0, 12)}`,
        },
        {
          userId: wrongStaff.id,
          warehouseId: wrongWarehouse.id,
          staffCode: `WRG-${runId.slice(0, 12)}`,
        },
      ],
    });
    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-P5-${runId.slice(0, 12).toUpperCase()}`,
        clientRequestId: randomUUID(),
        customerId: customer.id,
        senderSnapshot: { fullName: 'Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
        pickupSnapshot: { streetAddress: '1 Pickup Street', city: 'Ho Chi Minh City' },
        deliverySnapshot: { streetAddress: '2 Delivery Street', city: 'Ho Chi Minh City' },
        packageSnapshot: {
          description: 'Returnable package',
          packageType: 'PARCEL',
          weightGrams: 500,
        },
        pricingSnapshot: { totalFee: 30000 },
        totalFee: 30000,
        shippingFeeTransaction: { create: { payer: 'RECEIVER', expectedAmount: 30000 } },
        shippingFeePayer: 'RECEIVER',
        status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
        originWarehouseId: returnWarehouse.id,
        destinationWarehouseId: returnWarehouse.id,
        currentWarehouseId: returnWarehouse.id,
      },
    });
    shipmentId = shipment.id;

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password@123456' })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    dispatcherToken = await login(dispatcherEmail);
    driverToken = await login(driverEmail);
    otherDriverToken = await login(otherDriverEmail);
    returnStaffToken = await login(returnStaffEmail);
    wrongStaffToken = await login(wrongStaffEmail);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const shipments = await prisma.shipment.findMany({
      where: { customerId: { in: userIds } },
      select: { id: true },
    });
    const shipmentIds = shipments.map((shipment) => shipment.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.warehouse.deleteMany({
      where: { id: { in: [returnWarehouseId, wrongWarehouseId] } },
    });
    await app.close();
  });

  it('handles failed delivery → return request → owned driver return → authorized return receipt idempotently', async () => {
    mockLocationValues.set(
      `driver:location:${driverProfileId}`,
      JSON.stringify({
        driverId: driverProfileId,
        latitude: 10.777,
        longitude: 106.701,
        updatedAt: new Date().toISOString(),
      }),
    );
    const assignmentResponse = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/delivery-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ driverId: driverProfileId, clientRequestId: randomUUID() })
      .expect(201);
    const assignment = bodyFrom<{ id: string }>(assignmentResponse).data;

    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${assignment.id}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${assignment.id}/fail`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ reason: 'RECIPIENT_UNAVAILABLE', note: 'Recipient did not answer' })
      .expect(200);

    const requested = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/return/request`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ note: 'Return to origin warehouse', returnWarehouseId })
      .expect(200);
    expect(bodyFrom<{ status: ShipmentStatus }>(requested).data.status).toBe(
      ShipmentStatus.RETURN_REQUESTED,
    );

    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${shipmentId}/start-return`)
      .set('Authorization', `Bearer ${otherDriverToken}`)
      .expect(404);

    const started = await request(server)
      .post(`/api/v1/driver/delivery-assignments/${shipmentId}/start-return`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(
      bodyFrom<{ status: ShipmentStatus; currentWarehouseId: string | null }>(started).data,
    ).toMatchObject({
      status: ShipmentStatus.RETURN_IN_TRANSIT,
      currentWarehouseId: null,
    });
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${shipmentId}/start-return`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect(
      await prisma.trackingEvent.count({
        where: { shipmentId, status: ShipmentStatus.RETURN_IN_TRANSIT },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'RETURN_START', actor: { email: driverEmail } },
      }),
    ).toBe(1);

    await request(server)
      .post(`/api/v1/warehouses/${wrongWarehouseId}/shipments/${shipmentId}/receive-return`)
      .set('Authorization', `Bearer ${wrongStaffToken}`)
      .send({ note: 'Wrong warehouse' })
      .expect(403);

    const received = await request(server)
      .post(`/api/v1/warehouses/${returnWarehouseId}/shipments/${shipmentId}/receive-return`)
      .set('Authorization', `Bearer ${returnStaffToken}`)
      .send({ note: 'Return received' })
      .expect(200);
    expect(
      bodyFrom<{ status: ShipmentStatus; currentWarehouseId: string | null }>(received).data,
    ).toMatchObject({
      status: ShipmentStatus.RETURNED,
      currentWarehouseId: returnWarehouseId,
    });
    await request(server)
      .post(`/api/v1/warehouses/${returnWarehouseId}/shipments/${shipmentId}/receive-return`)
      .set('Authorization', `Bearer ${returnStaffToken}`)
      .send({ note: 'Retry receipt' })
      .expect(200);
    expect(
      await prisma.trackingEvent.count({ where: { shipmentId, status: ShipmentStatus.RETURNED } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'RETURN_RECEIVED', actor: { email: returnStaffEmail } },
      }),
    ).toBe(1);
  });
});
