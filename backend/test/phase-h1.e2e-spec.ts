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
    mget: jest.fn(),
    quit: jest.fn(),
  }),
};

interface ApiEnvelope<T> {
  data: T;
}

interface ShippingFeePayload {
  id: string;
  payer: ShippingFeePayer;
  expectedAmount: number;
  collectedAmount: number | null;
  status: ShippingFeeTransactionStatus;
  collectedAt: string | null;
}

interface ShipmentPayload {
  id: string;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeePayload;
}

interface AssignmentPayload {
  id: string;
  shipmentId: string;
  shipmentStatus: ShipmentStatus;
  shippingFee: ShippingFeePayload;
  availableActions: { collectShippingFee: boolean };
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase H1 shipping fee transaction and collection (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let customerId = '';
  let warehouseId = '';
  let dispatcherId = '';
  let pickupDriverId = '';
  let deliveryDriverId = '';
  let failedDriverId = '';
  let senderShipmentId = '';
  let senderAssignmentId = '';
  let receiverShipmentId = '';
  let receiverAssignmentId = '';
  let failedShipmentId = '';
  let failedAssignmentId = '';
  let cancellableShipmentId = '';
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH1@Password123';
  const emails = {
    customer: `phase-h1-customer-${runId}@example.com`,
    dispatcher: `phase-h1-dispatcher-${runId}@example.com`,
    admin: `phase-h1-admin-${runId}@example.com`,
    pickupDriver: `phase-h1-pickup-${runId}@example.com`,
    deliveryDriver: `phase-h1-delivery-${runId}@example.com`,
    failedDriver: `phase-h1-failed-${runId}@example.com`,
    otherDriver: `phase-h1-other-${runId}@example.com`,
  };
  const tokens: Record<keyof typeof emails, string> = {
    customer: '',
    dispatcher: '',
    admin: '',
    pickupDriver: '',
    deliveryDriver: '',
    failedDriver: '',
    otherDriver: '',
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
      (Object.keys(emails) as Array<keyof typeof emails>).map((key) =>
        prisma.user.create({
          data: {
            email: emails[key],
            fullName: `Phase H1 ${key}`,
            phone: '0901234567',
            passwordHash,
            role:
              key === 'customer'
                ? UserRole.CUSTOMER
                : key === 'dispatcher'
                  ? UserRole.DISPATCHER
                  : key === 'admin'
                    ? UserRole.ADMIN
                    : UserRole.DRIVER,
          },
        }),
      ),
    );
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    customerId = userByEmail.get(emails.customer)!.id;
    dispatcherId = userByEmail.get(emails.dispatcher)!.id;
    warehouseId = (
      await prisma.warehouse.create({
        data: {
          code: `H1-${suffix}`,
          name: `Kho H1 ${suffix}`,
          address: '1 Nguyễn Huệ',
          city: 'Hồ Chí Minh',
        },
      })
    ).id;

    const createDriver = async (
      key: 'pickupDriver' | 'deliveryDriver' | 'failedDriver' | 'otherDriver',
    ) =>
      prisma.driverProfile.create({
        data: {
          userId: userByEmail.get(emails[key])!.id,
          operatingWarehouseId: warehouseId,
          employeeCode: `H1-${key}-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `H1-${key.slice(0, 3).toUpperCase()}-${suffix}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      });
    const [pickupDriver, deliveryDriver, failedDriver] = await Promise.all([
      createDriver('pickupDriver'),
      createDriver('deliveryDriver'),
      createDriver('failedDriver'),
      createDriver('otherDriver'),
    ]);
    pickupDriverId = pickupDriver.id;
    deliveryDriverId = deliveryDriver.id;
    failedDriverId = failedDriver.id;

    const createShipment = async (
      label: string,
      payer: ShippingFeePayer,
      status: ShipmentStatus,
      totalFee: number,
      codAmount = 0,
    ) =>
      prisma.shipment.create({
        data: {
          trackingCode: `SHP-H1-${label}-${suffix}`,
          clientRequestId: randomUUID(),
          customerId,
          senderSnapshot: { fullName: 'Người gửi H1', phone: '0901234567' },
          receiverSnapshot: { fullName: 'Người nhận H1', phone: '0987654321' },
          pickupSnapshot: {
            contactName: 'Người gửi H1',
            phone: '0901234567',
            streetAddress: '1 Nguyễn Huệ',
            ward: 'Bến Nghé',
            district: 'Quận 1',
            city: 'Hồ Chí Minh',
          },
          deliverySnapshot: {
            contactName: 'Người nhận H1',
            phone: '0987654321',
            streetAddress: '2 Lê Lợi',
            ward: 'Bến Thành',
            district: 'Quận 1',
            city: 'Hồ Chí Minh',
          },
          packageSnapshot: {
            description: `Kiện H1 ${label}`,
            packageType: 'PARCEL',
            weightGrams: 1_000,
            lengthCm: 20,
            widthCm: 15,
            heightCm: 10,
          },
          pricingSnapshot: { totalFee },
          codAmount,
          totalFee,
          shippingFeePayer: payer,
          status,
          shippingFeeTransaction: { create: { payer, expectedAmount: totalFee } },
        },
      });

    const sender = await createShipment(
      'SENDER',
      ShippingFeePayer.SENDER,
      ShipmentStatus.PICKUP_IN_PROGRESS,
      35_000,
    );
    senderShipmentId = sender.id;
    senderAssignmentId = (
      await prisma.driverAssignment.create({
        data: {
          shipmentId: sender.id,
          driverId: pickupDriverId,
          type: DriverAssignmentType.PICKUP,
          status: DriverAssignmentStatus.ACCEPTED,
          clientRequestId: randomUUID(),
          assignedById: dispatcherId,
          acceptedAt: new Date(),
        },
      })
    ).id;

    const receiver = await createShipment(
      'RECEIVER',
      ShippingFeePayer.RECEIVER,
      ShipmentStatus.OUT_FOR_DELIVERY,
      42_000,
      500_000,
    );
    receiverShipmentId = receiver.id;
    const receiverAssignment = await prisma.driverAssignment.create({
      data: {
        shipmentId: receiver.id,
        driverId: deliveryDriverId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.ACCEPTED,
        clientRequestId: randomUUID(),
        assignedById: dispatcherId,
        acceptedAt: new Date(),
      },
    });
    receiverAssignmentId = receiverAssignment.id;
    await prisma.deliveryAttempt.create({
      data: {
        shipmentId: receiver.id,
        driverId: deliveryDriverId,
        driverAssignmentId: receiverAssignment.id,
        attemptNumber: 1,
        status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
      },
    });

    const failed = await createShipment(
      'FAILED',
      ShippingFeePayer.RECEIVER,
      ShipmentStatus.OUT_FOR_DELIVERY,
      38_000,
      300_000,
    );
    failedShipmentId = failed.id;
    const failedAssignment = await prisma.driverAssignment.create({
      data: {
        shipmentId: failed.id,
        driverId: failedDriverId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.ACCEPTED,
        clientRequestId: randomUUID(),
        assignedById: dispatcherId,
        acceptedAt: new Date(),
      },
    });
    failedAssignmentId = failedAssignment.id;
    await prisma.deliveryAttempt.create({
      data: {
        shipmentId: failed.id,
        driverId: failedDriverId,
        driverAssignmentId: failedAssignment.id,
        attemptNumber: 1,
        status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
      },
    });

    cancellableShipmentId = (
      await createShipment('CANCEL', ShippingFeePayer.SENDER, ShipmentStatus.PENDING, 30_000)
    ).id;

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      tokens[key] = await login(emails[key]);
    }
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const shipments = await prisma.shipment.findMany({
      where: { customerId: customerId || undefined },
      select: { id: true },
    });
    const shipmentIds = shipments.map(({ id }) => id);
    if (shipmentIds.length) {
      await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    await app.close();
  });

  it('collects sender fee exactly once at pickup and rejects amount/actor violations', async () => {
    const before = await request(server)
      .get(`/api/v1/driver/assignments/${senderAssignmentId}`)
      .set('Authorization', `Bearer ${tokens.pickupDriver}`)
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(before).data).toMatchObject({
      availableActions: { collectShippingFee: true },
      shippingFee: {
        payer: ShippingFeePayer.SENDER,
        expectedAmount: 35_000,
        status: ShippingFeeTransactionStatus.PENDING,
      },
    });

    await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.pickupDriver}`)
      .send({ shippingFeeAmount: 34_999 })
      .expect(400);
    await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.otherDriver}`)
      .send({ shippingFeeAmount: 35_000 })
      .expect(404);
    await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ shippingFeeAmount: 35_000 })
      .expect(403);

    const collected = await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.pickupDriver}`)
      .send({ shippingFeeAmount: 35_000, note: 'Đã thu đủ phí tại pickup' })
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(collected).data).toMatchObject({
      shipmentStatus: ShipmentStatus.PICKED_UP,
      availableActions: { collectShippingFee: false },
      shippingFee: {
        collectedAmount: 35_000,
        status: ShippingFeeTransactionStatus.COLLECTED,
      },
    });

    await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.pickupDriver}`)
      .send({ shippingFeeAmount: 35_000, note: 'retry' })
      .expect(200);

    expect(
      await prisma.shippingFeeTransaction.count({ where: { shipmentId: senderShipmentId } }),
    ).toBe(1);
    const transaction = await prisma.shippingFeeTransaction.findUniqueOrThrow({
      where: { shipmentId: senderShipmentId },
    });
    expect(transaction).toMatchObject({
      expectedAmount: 35_000,
      collectedAmount: 35_000,
      collectedByDriverId: pickupDriverId,
      status: ShippingFeeTransactionStatus.COLLECTED,
    });
    expect(transaction.collectedAt).toBeInstanceOf(Date);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'SHIPPING_FEE_COLLECTED',
          entityType: 'ShippingFeeTransaction',
          entityId: transaction.id,
        },
      }),
    ).toBe(1);
    expect(await prisma.cODTransaction.count({ where: { shipmentId: senderShipmentId } })).toBe(0);
  });

  it('collects receiver fee only with delivery success and leaves COD amounts untouched', async () => {
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${receiverAssignmentId}/complete`)
      .set('Authorization', `Bearer ${tokens.otherDriver}`)
      .send({ receiverName: 'Người nhận H1', shippingFeeAmount: 42_000 })
      .expect(404);
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${receiverAssignmentId}/complete`)
      .set('Authorization', `Bearer ${tokens.deliveryDriver}`)
      .send({ receiverName: 'Người nhận H1', shippingFeeAmount: 42_001 })
      .expect(400);

    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: receiverShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PENDING, collectedAmount: null });

    const completed = await request(server)
      .post(`/api/v1/driver/delivery-assignments/${receiverAssignmentId}/complete`)
      .set('Authorization', `Bearer ${tokens.deliveryDriver}`)
      .send({
        receiverName: 'Người nhận H1',
        shippingFeeAmount: 42_000,
        note: 'Giao thành công và thu đủ phí',
      })
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(completed).data).toMatchObject({
      shipmentStatus: ShipmentStatus.DELIVERED,
      availableActions: { collectShippingFee: false },
      shippingFee: {
        payer: ShippingFeePayer.RECEIVER,
        expectedAmount: 42_000,
        collectedAmount: 42_000,
        status: ShippingFeeTransactionStatus.COLLECTED,
      },
    });
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${receiverAssignmentId}/complete`)
      .set('Authorization', `Bearer ${tokens.deliveryDriver}`)
      .send({ receiverName: 'Người nhận H1', shippingFeeAmount: 42_000 })
      .expect(200);

    const cod = await prisma.cODTransaction.findUniqueOrThrow({
      where: { shipmentId: receiverShipmentId },
    });
    expect(cod).toMatchObject({
      expectedAmount: 500_000,
      collectedAmount: 500_000,
      status: CODTransactionStatus.COLLECTED,
    });
    expect(cod.expectedAmount).not.toBe(542_000);
    expect(
      await prisma.shippingFeeTransaction.count({ where: { shipmentId: receiverShipmentId } }),
    ).toBe(1);
    expect(await prisma.shipmentProof.count({ where: { shipmentId: receiverShipmentId } })).toBe(1);
  });

  it('does not collect receiver fee or COD when delivery fails', async () => {
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${failedAssignmentId}/fail`)
      .set('Authorization', `Bearer ${tokens.failedDriver}`)
      .send({ reason: 'RECIPIENT_UNAVAILABLE', note: 'Không liên hệ được' })
      .expect(200);

    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: failedShipmentId },
      }),
    ).toMatchObject({
      payer: ShippingFeePayer.RECEIVER,
      status: ShippingFeeTransactionStatus.PENDING,
      collectedAmount: null,
      collectedByDriverId: null,
    });
    expect(await prisma.cODTransaction.count({ where: { shipmentId: failedShipmentId } })).toBe(0);
  });

  it('exposes fee payer/status to Customer, Dispatcher and Admin and cancels a pending fee', async () => {
    for (const [path, token] of [
      [`/api/v1/shipments/${senderShipmentId}`, tokens.customer],
      [`/api/v1/dispatcher/shipments/${senderShipmentId}`, tokens.dispatcher],
      [`/api/v1/dispatcher/shipments/${senderShipmentId}`, tokens.admin],
    ] as const) {
      const response = await request(server)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(bodyFrom<ShipmentPayload>(response).data).toMatchObject({
        shippingFeePayer: ShippingFeePayer.SENDER,
        shippingFee: {
          payer: ShippingFeePayer.SENDER,
          expectedAmount: 35_000,
          status: ShippingFeeTransactionStatus.COLLECTED,
        },
      });
    }

    const cancelled = await request(server)
      .post(`/api/v1/shipments/${cancellableShipmentId}/cancel`)
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ reason: 'Không còn nhu cầu gửi' })
      .expect(200);
    expect(bodyFrom<ShipmentPayload>(cancelled).data.shippingFee.status).toBe(
      ShippingFeeTransactionStatus.CANCELLED,
    );
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: cancellableShipmentId },
      }),
    ).toMatchObject({
      status: ShippingFeeTransactionStatus.CANCELLED,
      collectedAmount: null,
      collectedByDriverId: null,
    });
  });
});
