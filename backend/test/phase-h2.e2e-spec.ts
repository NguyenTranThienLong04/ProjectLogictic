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

interface ShippingFeeItem {
  id: string;
  payer: ShippingFeePayer;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  status: ShippingFeeTransactionStatus;
  collectedAt: string | null;
  remittedAt: string | null;
  settledAt: string | null;
  shipment: { id: string; trackingCode: string };
  currentDispute: { reason: string; fromStatus: ShippingFeeTransactionStatus } | null;
  availableActions: { remit?: boolean; settle?: boolean; dispute?: boolean; resolve?: boolean };
}

interface ShippingFeeList {
  items: ShippingFeeItem[];
  summary: Array<{
    status: ShippingFeeTransactionStatus;
    totalAmount: number;
    count: number;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase H2 shipping fee remittance and reconciliation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let customerId = '';
  let warehouseId = '';
  let driverId = '';
  let otherDriverId = '';
  let lifecycleShipmentId = '';
  let lifecycleFeeId = '';
  let otherFeeId = '';
  let disputedFeeId = '';
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH2@Password123';
  const emails = {
    customer: `phase-h2-customer-${runId}@example.com`,
    admin: `phase-h2-admin-${runId}@example.com`,
    driver: `phase-h2-driver-${runId}@example.com`,
    otherDriver: `phase-h2-other-driver-${runId}@example.com`,
  };
  const tokens: Record<keyof typeof emails, string> = {
    customer: '',
    admin: '',
    driver: '',
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
            fullName: `Phase H2 ${key}`,
            phone: '0901234567',
            passwordHash,
            role:
              key === 'customer'
                ? UserRole.CUSTOMER
                : key === 'admin'
                  ? UserRole.ADMIN
                  : UserRole.DRIVER,
          },
        }),
      ),
    );
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    customerId = userByEmail.get(emails.customer)!.id;
    const adminId = userByEmail.get(emails.admin)!.id;
    warehouseId = (
      await prisma.warehouse.create({
        data: {
          code: `H2-${suffix}`,
          name: `Kho H2 ${suffix}`,
          address: '1 Nguyễn Huệ',
          city: 'Hồ Chí Minh',
        },
      })
    ).id;
    const [driver, otherDriver] = await Promise.all([
      prisma.driverProfile.create({
        data: {
          userId: userByEmail.get(emails.driver)!.id,
          operatingWarehouseId: warehouseId,
          employeeCode: `H2-DRIVER-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `H2-D-${suffix}`,
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        },
      }),
      prisma.driverProfile.create({
        data: {
          userId: userByEmail.get(emails.otherDriver)!.id,
          operatingWarehouseId: warehouseId,
          employeeCode: `H2-OTHER-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `H2-O-${suffix}`,
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        },
      }),
    ]);
    driverId = driver.id;
    otherDriverId = otherDriver.id;

    const createShipment = async (label: string, payer: ShippingFeePayer, totalFee: number) =>
      prisma.shipment.create({
        data: {
          trackingCode: `SHP-H2-${label}-${suffix}`,
          clientRequestId: randomUUID(),
          customerId,
          senderSnapshot: { fullName: 'Người gửi H2', contactName: 'Người gửi H2' },
          receiverSnapshot: { fullName: 'Người nhận H2', contactName: 'Người nhận H2' },
          pickupSnapshot: { contactName: 'Người gửi H2', city: 'Hồ Chí Minh' },
          deliverySnapshot: { contactName: 'Người nhận H2', city: 'Hồ Chí Minh' },
          packageSnapshot: { description: `Kiện H2 ${label}`, weightGrams: 1_000 },
          pricingSnapshot: { totalFee },
          codAmount: label === 'LIFECYCLE' ? 120_000 : 0,
          totalFee,
          shippingFeePayer: payer,
          status: ShipmentStatus.DELIVERED,
        },
      });
    const collectedAt = new Date('2026-09-07T08:00:00.000Z');

    const lifecycleShipment = await createShipment('LIFECYCLE', ShippingFeePayer.SENDER, 35_000);
    lifecycleShipmentId = lifecycleShipment.id;
    lifecycleFeeId = (
      await prisma.shippingFeeTransaction.create({
        data: {
          shipmentId: lifecycleShipment.id,
          payer: ShippingFeePayer.SENDER,
          expectedAmount: 35_000,
          collectedAmount: 35_000,
          collectedByDriverId: driverId,
          collectedAt,
          status: ShippingFeeTransactionStatus.COLLECTED,
        },
      })
    ).id;
    await prisma.cODTransaction.create({
      data: {
        shipmentId: lifecycleShipment.id,
        expectedAmount: 120_000,
        collectedAmount: 120_000,
        collectedByDriverId: driverId,
        collectedAt,
        status: CODTransactionStatus.COLLECTED,
      },
    });

    const otherShipment = await createShipment('OTHER', ShippingFeePayer.RECEIVER, 42_000);
    otherFeeId = (
      await prisma.shippingFeeTransaction.create({
        data: {
          shipmentId: otherShipment.id,
          payer: ShippingFeePayer.RECEIVER,
          expectedAmount: 42_000,
          collectedAmount: 42_000,
          collectedByDriverId: otherDriverId,
          collectedAt,
          status: ShippingFeeTransactionStatus.COLLECTED,
        },
      })
    ).id;

    const disputedShipment = await createShipment('DISPUTED', ShippingFeePayer.RECEIVER, 38_000);
    disputedFeeId = (
      await prisma.shippingFeeTransaction.create({
        data: {
          shipmentId: disputedShipment.id,
          payer: ShippingFeePayer.RECEIVER,
          expectedAmount: 38_000,
          collectedAmount: 38_000,
          collectedByDriverId: driverId,
          collectedAt,
          status: ShippingFeeTransactionStatus.DISPUTED,
          disputes: {
            create: {
              fromStatus: ShippingFeeTransactionStatus.COLLECTED,
              reason: 'Biên nhận thu phí cần xác minh',
              openedById: adminId,
            },
          },
        },
      })
    ).id;

    const pendingShipment = await createShipment('PENDING', ShippingFeePayer.SENDER, 30_000);
    await prisma.shippingFeeTransaction.create({
      data: {
        shipmentId: pendingShipment.id,
        payer: ShippingFeePayer.SENDER,
        expectedAmount: 30_000,
      },
    });

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
      const fees = await prisma.shippingFeeTransaction.findMany({
        where: { shipmentId: { in: shipmentIds } },
        select: { id: true },
      });
      await prisma.shippingFeeDispute.deleteMany({
        where: { shippingFeeTransactionId: { in: fees.map(({ id }) => id) } },
      });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    await app.close();
  });

  it('enforces Driver scope and exact amount, then remits idempotently without changing COD', async () => {
    await request(server)
      .get('/api/v1/shipping-fees/mine')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .expect(403);
    const mine = await request(server)
      .get('/api/v1/shipping-fees/mine')
      .set('Authorization', `Bearer ${tokens.driver}`)
      .expect(200);
    const mineBody = bodyFrom<ShippingFeeList>(mine).data;
    expect(mineBody.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([lifecycleFeeId, disputedFeeId]),
    );
    expect(mineBody.items.map(({ id }) => id)).not.toContain(otherFeeId);

    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/remit`)
      .set('Authorization', `Bearer ${tokens.otherDriver}`)
      .send({ amount: 35_000 })
      .expect(404);
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/remit`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .send({ amount: 34_999 })
      .expect(400);
    await request(server)
      .post(`/api/v1/shipping-fees/${disputedFeeId}/remit`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .send({ amount: 38_000 })
      .expect(409);

    const remitted = await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/remit`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .send({ amount: 35_000 })
      .expect(200);
    expect(bodyFrom<ShippingFeeItem>(remitted).data).toMatchObject({
      id: lifecycleFeeId,
      status: ShippingFeeTransactionStatus.REMITTED,
      remittedAmount: 35_000,
    });
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/remit`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .send({ amount: 35_000 })
      .expect(200);

    expect(
      await prisma.auditLog.count({
        where: { entityId: lifecycleFeeId, action: 'SHIPPING_FEE_REMITTED' },
      }),
    ).toBe(1);
    expect(
      await prisma.cODTransaction.findUniqueOrThrow({ where: { shipmentId: lifecycleShipmentId } }),
    ).toMatchObject({
      expectedAmount: 120_000,
      collectedAmount: 120_000,
      remittedAmount: null,
      status: CODTransactionStatus.COLLECTED,
    });
  });

  it('requires a reason, blocks direct settlement during dispute, resolves, and settles once', async () => {
    await request(server)
      .get('/api/v1/shipping-fees/reconciliation')
      .set('Authorization', `Bearer ${tokens.driver}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/settle`)
      .set('Authorization', `Bearer ${tokens.driver}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/dispute`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: '' })
      .expect(400);

    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/dispute`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: 'Biên nhận bàn giao cần đối chiếu' })
      .expect(200);
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/dispute`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: 'Biên nhận bàn giao cần đối chiếu' })
      .expect(200);
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/settle`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(409);

    const resolved = await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/resolve`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ resolutionNote: 'Đã xác minh đủ tiền và biên nhận' })
      .expect(200);
    expect(bodyFrom<ShippingFeeItem>(resolved).data.status).toBe(
      ShippingFeeTransactionStatus.REMITTED,
    );
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/resolve`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ resolutionNote: 'Đã xác minh đủ tiền và biên nhận' })
      .expect(200);

    const settled = await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/settle`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    expect(bodyFrom<ShippingFeeItem>(settled).data).toMatchObject({
      status: ShippingFeeTransactionStatus.SETTLED,
      collectedAmount: 35_000,
      remittedAmount: 35_000,
    });
    await request(server)
      .post(`/api/v1/shipping-fees/${lifecycleFeeId}/settle`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    expect(
      await prisma.shippingFeeDispute.count({
        where: { shippingFeeTransactionId: lifecycleFeeId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: lifecycleFeeId,
          action: {
            in: ['SHIPPING_FEE_DISPUTED', 'SHIPPING_FEE_DISPUTE_RESOLVED', 'SHIPPING_FEE_SETTLED'],
          },
        },
      }),
    ).toBe(3);
  });

  it('returns filterable reconciliation totals and keeps Customer payload private', async () => {
    const reconciliation = await request(server)
      .get('/api/v1/shipping-fees/reconciliation')
      .query({ payer: ShippingFeePayer.RECEIVER, status: ShippingFeeTransactionStatus.COLLECTED })
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    const data = bodyFrom<ShippingFeeList>(reconciliation).data;
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: otherFeeId,
      payer: ShippingFeePayer.RECEIVER,
      status: ShippingFeeTransactionStatus.COLLECTED,
      collectedAmount: 42_000,
    });
    expect(data.summary).toContainEqual({
      status: ShippingFeeTransactionStatus.COLLECTED,
      totalAmount: 42_000,
      count: 1,
    });
    expect(data.summary).toContainEqual({
      status: ShippingFeeTransactionStatus.DISPUTED,
      totalAmount: 38_000,
      count: 1,
    });

    const search = await request(server)
      .get('/api/v1/shipping-fees/reconciliation')
      .query({ search: `SHP-H2-OTHER-${suffix}` })
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    expect(bodyFrom<ShippingFeeList>(search).data).toMatchObject({ total: 1 });

    const customerDetail = await request(server)
      .get(`/api/v1/shipments/${lifecycleShipmentId}`)
      .set('Authorization', `Bearer ${tokens.customer}`)
      .expect(200);
    const customerData = bodyFrom<{ shippingFee: Record<string, unknown> }>(customerDetail).data;
    expect(customerData.shippingFee).toMatchObject({
      status: ShippingFeeTransactionStatus.SETTLED,
      expectedAmount: 35_000,
      remittedAmount: 35_000,
    });
    expect(customerData.shippingFee).not.toHaveProperty('collectedByDriverId');
    expect(customerData.shippingFee).not.toHaveProperty('remittedByDriverId');
    expect(customerData.shippingFee).not.toHaveProperty('settledById');
    expect(customerData.shippingFee).not.toHaveProperty('disputes');
  });
});
