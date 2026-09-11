import { createHmac, randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
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
  ShippingFeePaymentStatus,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  UserRole,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

const webhookSecret = 'phase-h3-test-only-webhook-secret-32-characters';
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

interface PaymentPayload {
  reference: string;
  amount: number;
  payer: ShippingFeePayer;
  status: ShippingFeePaymentStatus;
  feeStatus: ShippingFeeTransactionStatus;
  checkoutUrl: string | null;
  shipment: { id: string; trackingCode: string };
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase H3 provider-neutral shipping-fee payment (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let warehouseId = '';
  let driverId = '';
  let deliveryDriverId = '';
  let senderShipmentId = '';
  let senderAssignmentId = '';
  let receiverShipmentId = '';
  let receiverAssignmentId = '';
  let failedShipmentId = '';
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH3@Password123';
  const emails = {
    customer: `phase-h3-customer-${runId}@example.com`,
    otherCustomer: `phase-h3-other-${runId}@example.com`,
    driver: `phase-h3-driver-${runId}@example.com`,
    deliveryDriver: `phase-h3-delivery-driver-${runId}@example.com`,
  };
  const tokens: Record<keyof typeof emails, string> = {
    customer: '',
    otherCustomer: '',
    driver: '',
    deliveryDriver: '',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
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
    const [customer, , driverUser, deliveryDriverUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: emails.customer,
          fullName: 'Phase H3 Customer',
          phone: '0901234567',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.otherCustomer,
          fullName: 'Phase H3 Other Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.driver,
          fullName: 'Phase H3 Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.deliveryDriver,
          fullName: 'Phase H3 Delivery Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
    ]);
    warehouseId = (
      await prisma.warehouse.create({
        data: {
          code: `H3-${suffix}`,
          name: `Kho H3 ${suffix}`,
          address: '1 Nguyễn Huệ',
          city: 'Hồ Chí Minh',
        },
      })
    ).id;
    driverId = (
      await prisma.driverProfile.create({
        data: {
          userId: driverUser.id,
          operatingWarehouseId: warehouseId,
          employeeCode: `H3-D-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `H3-D-${suffix}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      })
    ).id;
    deliveryDriverId = (
      await prisma.driverProfile.create({
        data: {
          userId: deliveryDriverUser.id,
          operatingWarehouseId: warehouseId,
          employeeCode: `H3-R-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `H3-R-${suffix}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      })
    ).id;

    const sender = await createShipment(customer.id, 'SENDER', ShippingFeePayer.SENDER, 35_000, 0);
    senderShipmentId = sender.id;
    senderAssignmentId = (
      await prisma.driverAssignment.create({
        data: {
          shipmentId: sender.id,
          driverId,
          type: DriverAssignmentType.PICKUP,
          status: DriverAssignmentStatus.ACCEPTED,
          clientRequestId: randomUUID(),
          assignedById: driverUser.id,
          acceptedAt: new Date(),
        },
      })
    ).id;

    const receiver = await createShipment(
      customer.id,
      'RECEIVER',
      ShippingFeePayer.RECEIVER,
      42_000,
      500_000,
    );
    receiverShipmentId = receiver.id;
    const deliveryAssignment = await prisma.driverAssignment.create({
      data: {
        shipmentId: receiver.id,
        driverId: deliveryDriverId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.ACCEPTED,
        clientRequestId: randomUUID(),
        assignedById: deliveryDriverUser.id,
        acceptedAt: new Date(),
      },
    });
    receiverAssignmentId = deliveryAssignment.id;
    await prisma.deliveryAttempt.create({
      data: {
        shipmentId: receiver.id,
        driverId: deliveryDriverId,
        driverAssignmentId: deliveryAssignment.id,
        attemptNumber: 1,
        status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
      },
    });

    failedShipmentId = (
      await createShipment(customer.id, 'FAILED', ShippingFeePayer.SENDER, 38_000, 0)
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
    const shipmentIds = [senderShipmentId, receiverShipmentId, failedShipmentId].filter(Boolean);
    const paymentIds = (
      await prisma.shippingFeePayment.findMany({
        where: { shippingFeeTransaction: { shipmentId: { in: shipmentIds } } },
        select: { id: true },
      })
    ).map(({ id }) => id);
    await prisma.shippingFeePaymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.shippingFeePayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('creates an idempotent SENDER payment and browser-result GET cannot mutate state', async () => {
    const clientRequestId = randomUUID();
    await request(server)
      .post('/api/v1/shipping-fee-payments')
      .set('Authorization', `Bearer ${tokens.otherCustomer}`)
      .send({ shipmentId: senderShipmentId, clientRequestId })
      .expect(404);

    const created = await createPayment(senderShipmentId, clientRequestId);
    expect(created).toMatchObject({
      payer: ShippingFeePayer.SENDER,
      amount: 35_000,
      status: ShippingFeePaymentStatus.PENDING,
      feeStatus: ShippingFeeTransactionStatus.PAYMENT_PENDING,
      shipment: { id: senderShipmentId },
    });
    expect(created.checkoutUrl).toContain('/payments/result?reference=');

    const retry = await createPayment(senderShipmentId, clientRequestId);
    expect(retry.reference).toBe(created.reference);
    expect(
      await prisma.shippingFeePayment.count({
        where: { shippingFeeTransaction: { shipmentId: senderShipmentId } },
      }),
    ).toBe(1);

    const result = await request(server)
      .get(`/api/v1/shipping-fee-payments/results/${created.reference}`)
      .set('Authorization', `Bearer ${tokens.customer}`)
      .expect(200);
    const resultData = bodyFrom<Record<string, unknown>>(result).data;
    expect(resultData).toMatchObject({ status: ShippingFeePaymentStatus.PENDING });
    expect(resultData).not.toHaveProperty('provider');
    expect(resultData).not.toHaveProperty('providerReference');
    expect(resultData).not.toHaveProperty('rawPayload');
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: senderShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PAYMENT_PENDING, paidAmount: null });
  });

  it('rejects invalid signature, wrong amount/reference, and replay payload before mutation', async () => {
    const payment = await prisma.shippingFeePayment.findFirstOrThrow({
      where: { shippingFeeTransaction: { shipmentId: senderShipmentId } },
    });
    const base = webhookBody(payment.reference, payment.providerReference!, 35_000, 'SUCCEEDED');
    await postWebhook(base, '0'.repeat(64)).expect(400);
    await postWebhook(
      webhookBody(payment.reference, payment.providerReference!, 34_999, 'SUCCEEDED'),
    ).expect(400);
    await postWebhook(
      webhookBody(payment.reference, 'TEST-WRONG-REFERENCE', 35_000, 'SUCCEEDED'),
    ).expect(400);
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: senderShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PAYMENT_PENDING, paidAmount: null });

    const success = await postWebhook(base).expect(200);
    expect(bodyFrom<{ duplicate: boolean }>(success).data.duplicate).toBe(false);
    const duplicate = await postWebhook(base).expect(200);
    expect(bodyFrom<{ duplicate: boolean }>(duplicate).data.duplicate).toBe(true);
    const replay = JSON.parse(base) as Record<string, unknown>;
    replay.amount = 35_001;
    await postWebhook(JSON.stringify(replay)).expect(409);

    const fee = await prisma.shippingFeeTransaction.findUniqueOrThrow({
      where: { shipmentId: senderShipmentId },
    });
    expect(fee).toMatchObject({
      status: ShippingFeeTransactionStatus.PAID,
      paidAmount: 35_000,
      collectedAmount: null,
      remittedAmount: null,
      settledById: null,
    });
    expect(await prisma.shippingFeePaymentEvent.count({ where: { paymentId: payment.id } })).toBe(
      1,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: payment.id, action: 'SHIPPING_FEE_ONLINE_PAID' },
      }),
    ).toBe(1);
  });

  it('lets operations continue without cash collection after SENDER online payment', async () => {
    await request(server)
      .post(`/api/v1/driver/assignments/${senderAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .send({ note: 'Phí đã thanh toán trực tuyến' })
      .expect(200);
    expect(await prisma.cODTransaction.count({ where: { shipmentId: senderShipmentId } })).toBe(0);
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: senderShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PAID, collectedByDriverId: null });
  });

  it('supports RECEIVER payment and keeps COD collection exactly separate', async () => {
    const payment = await createPayment(receiverShipmentId, randomUUID());
    expect(payment).toMatchObject({ payer: ShippingFeePayer.RECEIVER, amount: 42_000 });
    const stored = await prisma.shippingFeePayment.findUniqueOrThrow({
      where: { reference: payment.reference },
    });
    await postWebhook(
      webhookBody(payment.reference, stored.providerReference!, 42_000, 'SUCCEEDED'),
    ).expect(200);

    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${receiverAssignmentId}/complete`)
      .set('Authorization', `Bearer ${tokens.deliveryDriver}`)
      .send({ receiverName: 'Người nhận H3', note: 'Đã thanh toán trực tuyến' })
      .expect(200);
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: receiverShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PAID, paidAmount: 42_000 });
    expect(
      await prisma.cODTransaction.findUniqueOrThrow({ where: { shipmentId: receiverShipmentId } }),
    ).toMatchObject({
      expectedAmount: 500_000,
      collectedAmount: 500_000,
      status: CODTransactionStatus.COLLECTED,
    });
  });

  it('uses authoritative failure to release a safe retry without duplicate payment', async () => {
    const first = await createPayment(failedShipmentId, randomUUID());
    const stored = await prisma.shippingFeePayment.findUniqueOrThrow({
      where: { reference: first.reference },
    });
    await postWebhook(
      webhookBody(first.reference, stored.providerReference!, 38_000, 'FAILED', 'DECLINED'),
    ).expect(200);
    expect(
      await prisma.shippingFeeTransaction.findUniqueOrThrow({
        where: { shipmentId: failedShipmentId },
      }),
    ).toMatchObject({ status: ShippingFeeTransactionStatus.PENDING, paidAmount: null });

    const second = await createPayment(failedShipmentId, randomUUID());
    expect(second.reference).not.toBe(first.reference);
    expect(
      await prisma.shippingFeePayment.count({
        where: { shippingFeeTransaction: { shipmentId: failedShipmentId } },
      }),
    ).toBe(2);
    expect(
      await prisma.shippingFeePayment.count({
        where: {
          shippingFeeTransaction: { shipmentId: failedShipmentId },
          status: { in: [ShippingFeePaymentStatus.CREATING, ShippingFeePaymentStatus.PENDING] },
        },
      }),
    ).toBe(1);
  });

  async function createShipment(
    customerId: string,
    label: string,
    payer: ShippingFeePayer,
    totalFee: number,
    codAmount: number,
  ) {
    return prisma.shipment.create({
      data: {
        trackingCode: `SHP-H3-${label}-${suffix}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: 'Người gửi H3', phone: '0901234567' },
        receiverSnapshot: { fullName: 'Người nhận H3', phone: '0987654321' },
        pickupSnapshot: {
          contactName: 'Người gửi H3',
          phone: '0901234567',
          streetAddress: '1 Nguyễn Huệ',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        },
        deliverySnapshot: {
          contactName: 'Người nhận H3',
          phone: '0987654321',
          streetAddress: '2 Lê Lợi',
          ward: 'Bến Thành',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        },
        packageSnapshot: {
          description: `Kiện H3 ${label}`,
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
        status:
          payer === ShippingFeePayer.SENDER
            ? ShipmentStatus.PICKUP_IN_PROGRESS
            : ShipmentStatus.OUT_FOR_DELIVERY,
        shippingFeeTransaction: { create: { payer, expectedAmount: totalFee } },
      },
    });
  }

  async function createPayment(shipmentId: string, clientRequestId: string) {
    const response = await request(server)
      .post('/api/v1/shipping-fee-payments')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ shipmentId, clientRequestId })
      .expect(201);
    return bodyFrom<PaymentPayload>(response).data;
  }

  function webhookBody(
    reference: string,
    providerReference: string,
    amount: number,
    status: 'SUCCEEDED' | 'FAILED',
    failureCode?: string,
  ): string {
    return JSON.stringify({
      eventId: `evt-${randomUUID()}`,
      reference,
      providerReference,
      amount,
      status,
      occurredAt: new Date().toISOString(),
      ...(failureCode ? { failureCode } : {}),
    });
  }

  function postWebhook(rawBody: string, signature?: string) {
    const hmac = signature ?? createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return request(server)
      .post('/api/v1/shipping-fee-payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', hmac)
      .send(rawBody);
  }
});
