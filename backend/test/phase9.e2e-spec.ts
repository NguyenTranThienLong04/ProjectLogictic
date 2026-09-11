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
  CODTransactionStatus,
  DeliveryAttemptStatus,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  ShipmentStatus,
  UserRole,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

const mockRedisService = {
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
  getClient: jest.fn().mockReturnValue({
    status: 'ready',
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
  }),
};

interface ApiEnvelope<T> {
  data: T;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase 9 admin analytics PostgreSQL aggregation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken = '';
  let customerToken = '';
  let adminId = '';
  let driverProfileId = '';
  let shipmentId = '';
  let assignmentId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  const runId = randomUUID().replaceAll('-', '');
  const adminEmail = `admin-p9-${runId}@example.com`;
  const customerEmail = `customer-p9-${runId}@example.com`;
  const driverEmail = `driver-p9-${runId}@example.com`;
  const emails = [adminEmail, customerEmail, driverEmail];

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

    const passwordHash = await app.get(PasswordHasherService).hash('Password@123456');
    const [admin, customer, driver] = await Promise.all([
      prisma.user.create({
        data: {
          email: adminEmail,
          fullName: 'Analytics Admin',
          passwordHash,
          role: UserRole.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          email: customerEmail,
          fullName: 'Analytics Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: driverEmail,
          fullName: 'Analytics Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
    ]);
    adminId = admin.id;
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driver.id,
        employeeCode: `DRV-P9-${runId.slice(0, 10).toUpperCase()}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `59P9-${runId.slice(0, 5).toUpperCase()}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    });
    driverProfileId = driverProfile.id;
    const [origin, destination] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `P9O-${runId.slice(0, 8).toUpperCase()}`,
          name: 'Phase 9 Origin',
          address: '1 Origin Street',
          city: 'Ho Chi Minh City',
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `P9D-${runId.slice(0, 8).toUpperCase()}`,
          name: 'Phase 9 Destination',
          address: '2 Destination Street',
          city: 'Ho Chi Minh City',
        },
      }),
    ]);
    originWarehouseId = origin.id;
    destinationWarehouseId = destination.id;
    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-P9-${runId.slice(0, 12).toUpperCase()}`,
        clientRequestId: randomUUID(),
        customerId: customer.id,
        senderSnapshot: { fullName: 'Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
        pickupSnapshot: { streetAddress: '1 Origin Street', city: 'Ho Chi Minh City' },
        deliverySnapshot: { streetAddress: '2 Destination Street', city: 'Ho Chi Minh City' },
        packageSnapshot: {
          description: 'Analytics parcel',
          packageType: 'PARCEL',
          weightGrams: 500,
        },
        pricingSnapshot: { totalFee: 30_000, codAmount: 250_000 },
        codAmount: 250_000,
        totalFee: 30_000,
        status: ShipmentStatus.DELIVERED,
        originWarehouseId,
        destinationWarehouseId,
      },
    });
    shipmentId = shipment.id;
    const assignment = await prisma.driverAssignment.create({
      data: {
        shipmentId,
        driverId: driverProfileId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.COMPLETED,
        clientRequestId: randomUUID(),
        assignedById: adminId,
        acceptedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        completedAt: new Date(),
      },
    });
    assignmentId = assignment.id;
    await Promise.all([
      prisma.deliveryAttempt.create({
        data: {
          shipmentId,
          driverId: driverProfileId,
          driverAssignmentId: assignmentId,
          attemptNumber: 1,
          status: DeliveryAttemptStatus.DELIVERED,
          startedAt: new Date(Date.now() - 60 * 60 * 1000),
          completedAt: new Date(),
        },
      }),
      prisma.cODTransaction.create({
        data: {
          shipmentId,
          expectedAmount: 250_000,
          collectedAmount: 250_000,
          remittedAmount: 250_000,
          status: CODTransactionStatus.SETTLED,
          collectedByDriverId: driverProfileId,
          collectedAt: new Date(),
          remittedAt: new Date(),
          settledAt: new Date(),
        },
      }),
    ]);

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password@123456' })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [adminToken, customerToken] = await Promise.all([login(adminEmail), login(customerEmail)]);
  });

  afterAll(async () => {
    await prisma.shipmentProof.deleteMany({ where: { shipmentId } });
    await prisma.deliveryAttempt.deleteMany({ where: { shipmentId } });
    await prisma.cODTransaction.deleteMany({ where: { shipmentId } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.warehouse.deleteMany({
      where: { id: { in: [originWarehouseId, destinationWarehouseId] } },
    });
    await app.close();
  });

  it('returns DB-aggregated filtered metrics to admins and denies customers', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server)
      .get('/api/v1/admin/analytics')
      .query({
        from: today,
        to: today,
        warehouseId: destinationWarehouseId,
        driverId: driverProfileId,
        granularity: 'day',
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const analytics = bodyFrom<{
      overview: { totalShipments: number; delivered: number; deliverySuccessRate: number };
      shipmentTrend: Array<{ created: number; delivered: number }>;
      driverPerformance: Array<{ driverId: string; delivered: number }>;
      warehouseStats: Array<{ warehouseId: string; inboundShipments: number }>;
      codStats: { settledAmount: number; unsettledAmount: number };
    }>(response).data;

    expect(analytics.overview).toMatchObject({
      totalShipments: 1,
      delivered: 1,
      deliverySuccessRate: 100,
    });
    expect(analytics.shipmentTrend).toEqual([
      expect.objectContaining({ created: 1, delivered: 1 }),
    ]);
    expect(analytics.driverPerformance).toEqual([
      expect.objectContaining({ driverId: driverProfileId, delivered: 1 }),
    ]);
    expect(analytics.warehouseStats).toEqual([
      expect.objectContaining({ warehouseId: destinationWarehouseId, inboundShipments: 1 }),
    ]);
    expect(analytics.codStats).toMatchObject({ settledAmount: 250_000, unsettledAmount: 0 });

    await request(server)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });
});
