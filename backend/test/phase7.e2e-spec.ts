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
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
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

describe('Phase 7 COD concurrency and settlement (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let hasher: PasswordHasherService;
  const runId = randomUUID().replaceAll('-', '');
  const driverEmail = `driver-p7-${runId}@example.com`;
  const adminEmail = `admin-p7-${runId}@example.com`;
  const customerEmail = `customer-p7-${runId}@example.com`;
  const emails = [driverEmail, adminEmail, customerEmail];
  const shipmentIds: string[] = [];
  let driverToken = '';
  let adminToken = '';
  let driverProfileId = '';
  let adminId = '';
  let customerId = '';

  const createShipment = async (suffix: string, codAmount: number, status: ShipmentStatus) => {
    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `SHP-P7-${suffix}-${runId.slice(0, 8).toUpperCase()}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: 'Sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
        pickupSnapshot: { streetAddress: '1 Pickup Street', city: 'Ho Chi Minh City' },
        deliverySnapshot: { streetAddress: '2 Delivery Street', city: 'Ho Chi Minh City' },
        packageSnapshot: { description: 'COD parcel', packageType: 'PARCEL', weightGrams: 500 },
        pricingSnapshot: { totalFee: 30_000, codAmount },
        codAmount,
        totalFee: 30_000,
        status,
        shippingFeePayer: ShippingFeePayer.SENDER,
        shippingFeeTransaction: {
          create: {
            payer: ShippingFeePayer.SENDER,
            expectedAmount: 30_000,
            collectedAmount: 30_000,
            status: ShippingFeeTransactionStatus.COLLECTED,
            collectedByDriverId: driverProfileId,
            collectedAt: new Date(),
          },
        },
      },
    });
    shipmentIds.push(shipment.id);
    return shipment;
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
    hasher = app.get(PasswordHasherService);

    const passwordHash = await hasher.hash('Password@123456');
    const [driver, admin, customer] = await Promise.all([
      prisma.user.create({
        data: { email: driverEmail, fullName: 'COD Driver', passwordHash, role: UserRole.DRIVER },
      }),
      prisma.user.create({
        data: { email: adminEmail, fullName: 'COD Admin', passwordHash, role: UserRole.ADMIN },
      }),
      prisma.user.create({
        data: {
          email: customerEmail,
          fullName: 'COD Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
    ]);
    adminId = admin.id;
    customerId = customer.id;
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driver.id,
        employeeCode: `DRV-P7-${runId.slice(0, 12).toUpperCase()}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `59P7-${runId.slice(0, 5).toUpperCase()}`,
        status: DriverStatus.BUSY,
        isOnline: true,
        isAvailable: false,
      },
    });
    driverProfileId = driverProfile.id;

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password@123456' })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    driverToken = await login(driverEmail);
    adminToken = await login(adminEmail);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('creates only one COD collection when successful delivery is retried', async () => {
    const shipment = await createShipment('DELIVERY', 275_000, ShipmentStatus.OUT_FOR_DELIVERY);
    const assignment = await prisma.driverAssignment.create({
      data: {
        shipmentId: shipment.id,
        driverId: driverProfileId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.ACCEPTED,
        clientRequestId: randomUUID(),
        assignedById: adminId,
        acceptedAt: new Date(),
      },
    });
    const deliveryAttempt = await prisma.deliveryAttempt.create({
      data: {
        shipmentId: shipment.id,
        driverId: driverProfileId,
        driverAssignmentId: assignment.id,
        attemptNumber: 1,
        status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(server)
        .post(`/api/v1/driver/delivery-assignments/${assignment.id}/complete`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ receiverName: 'COD Receiver' })
        .expect(200);
    }

    expect(await prisma.cODTransaction.count({ where: { shipmentId: shipment.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'DELIVERY_COMPLETE', entityId: deliveryAttempt.id },
      }),
    ).toBe(1);
  });

  it('allows only one remittance state transition and audit under concurrent requests', async () => {
    const shipment = await createShipment('REMIT', 150_000, ShipmentStatus.DELIVERED);
    const cod = await prisma.cODTransaction.create({
      data: {
        shipmentId: shipment.id,
        expectedAmount: 150_000,
        collectedAmount: 150_000,
        collectedByDriverId: driverProfileId,
        collectedAt: new Date(),
        status: CODTransactionStatus.COLLECTED,
      },
    });

    const responses = await Promise.all([
      request(server)
        .post(`/api/v1/cod/shipments/${shipment.id}/remit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ amount: 150_000 }),
      request(server)
        .post(`/api/v1/cod/shipments/${shipment.id}/remit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ amount: 150_000 }),
    ]);

    expect(responses.map(({ status }) => status)).toContain(200);
    expect(responses.every(({ status }) => status === 200 || status === 409)).toBe(true);
    await expect(
      prisma.cODTransaction.findUniqueOrThrow({ where: { id: cod.id } }),
    ).resolves.toMatchObject({
      status: CODTransactionStatus.REMITTED,
      remittedAmount: 150_000,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'COD_REMITTED', entityType: 'CODTransaction', entityId: cod.id },
      }),
    ).toBe(1);
  });

  it('allows only one settlement transition and rejects mismatched money', async () => {
    const settlementShipment = await createShipment('SETTLE', 225_000, ShipmentStatus.DELIVERED);
    const settlement = await prisma.cODTransaction.create({
      data: {
        shipmentId: settlementShipment.id,
        expectedAmount: 225_000,
        collectedAmount: 225_000,
        remittedAmount: 225_000,
        collectedByDriverId: driverProfileId,
        collectedAt: new Date(),
        remittedAt: new Date(),
        status: CODTransactionStatus.REMITTED,
      },
    });

    const responses = await Promise.all([
      request(server)
        .post(`/api/v1/cod/${settlement.id}/settle`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(server)
        .post(`/api/v1/cod/${settlement.id}/settle`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(responses.map(({ status }) => status)).toContain(200);
    expect(responses.every(({ status }) => status === 200 || status === 409)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: 'COD_SETTLED', entityType: 'CODTransaction', entityId: settlement.id },
      }),
    ).toBe(1);

    const mismatchShipment = await createShipment('MISMATCH', 310_000, ShipmentStatus.DELIVERED);
    const mismatch = await prisma.cODTransaction.create({
      data: {
        shipmentId: mismatchShipment.id,
        expectedAmount: 310_000,
        collectedAmount: 310_000,
        remittedAmount: 309_000,
        collectedByDriverId: driverProfileId,
        collectedAt: new Date(),
        remittedAt: new Date(),
        status: CODTransactionStatus.REMITTED,
      },
    });

    await request(server)
      .post(`/api/v1/cod/${mismatch.id}/settle`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    await expect(
      prisma.cODTransaction.findUniqueOrThrow({ where: { id: mismatch.id } }),
    ).resolves.toMatchObject({
      status: CODTransactionStatus.REMITTED,
      settledAt: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'COD_SETTLED', entityType: 'CODTransaction', entityId: mismatch.id },
      }),
    ).toBe(0);
  });
});
