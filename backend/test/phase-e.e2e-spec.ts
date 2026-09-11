import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ShippingFeePayer, UserRole } from '../src/generated/prisma/client.js';
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

interface ShipmentPayload {
  id: string;
  trackingCode: string;
  sender: { fullName: string };
  pickup: { streetAddress: string };
  codAmount: number;
  totalFee: number;
  shippingFeePayer: ShippingFeePayer;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Operational Realism Phase E shipping fee payer (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let customerId = '';
  let adminId = '';
  let pickupAddressId = '';
  let customerToken = '';
  let otherCustomerToken = '';
  let dispatcherToken = '';
  let adminToken = '';
  let senderShipment: ShipmentPayload;
  let receiverShipment: ShipmentPayload;
  let previousActivePricingIds: string[] = [];
  const shipmentIds: string[] = [];
  const runId = randomUUID().replaceAll('-', '');
  const password = 'Password@123456';
  const emails = {
    customer: `phase-e-customer-${runId}@example.com`,
    otherCustomer: `phase-e-other-${runId}@example.com`,
    dispatcher: `phase-e-dispatcher-${runId}@example.com`,
    admin: `phase-e-admin-${runId}@example.com`,
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
    const [customer, , , admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: emails.customer,
          fullName: 'Phase E Customer',
          phone: '0901234567',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.otherCustomer,
          fullName: 'Phase E Other Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.dispatcher,
          fullName: 'Phase E Dispatcher',
          passwordHash,
          role: UserRole.DISPATCHER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.admin,
          fullName: 'Phase E Admin',
          passwordHash,
          role: UserRole.ADMIN,
        },
      }),
    ]);
    customerId = customer.id;
    adminId = admin.id;
    previousActivePricingIds = (
      await prisma.pricingConfig.findMany({ where: { isActive: true }, select: { id: true } })
    ).map((config) => config.id);

    const login = async (email: string) => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [customerToken, otherCustomerToken, dispatcherToken, adminToken] = await Promise.all([
      login(emails.customer),
      login(emails.otherCustomer),
      login(emails.dispatcher),
      login(emails.admin),
    ]);

    const addressResponse = await request(server)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Điểm lấy Phase E',
        contactName: 'Phase E Customer',
        phone: '0901234567',
        streetAddress: '1 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
      })
      .expect(201);
    pickupAddressId = bodyFrom<{ id: string }>(addressResponse).data.id;
  });

  afterAll(async () => {
    if (adminId) {
      const createdConfigs = await prisma.pricingConfig.findMany({
        where: { createdById: adminId },
        select: { id: true },
      });
      const createdConfigIds = createdConfigs.map((config) => config.id);
      if (createdConfigIds.length) {
        await prisma.auditLog.deleteMany({
          where: { entityType: 'PricingConfig', entityId: { in: createdConfigIds } },
        });
        await prisma.pricingConfig.deleteMany({ where: { id: { in: createdConfigIds } } });
      }
      if (previousActivePricingIds.length) {
        await prisma.pricingConfig.updateMany({
          where: { id: { in: previousActivePricingIds } },
          data: { isActive: true },
        });
      }
    }

    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const persistedShipments = await prisma.shipment.findMany({
      where: { customerId: { in: userIds } },
      select: { id: true },
    });
    const persistedShipmentIds = persistedShipments.map((shipment) => shipment.id);
    if (persistedShipmentIds.length) {
      await prisma.cODTransaction.deleteMany({
        where: { shipmentId: { in: persistedShipmentIds } },
      });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: persistedShipmentIds } },
      });
      await prisma.trackingEvent.deleteMany({
        where: { shipmentId: { in: persistedShipmentIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityType: 'Shipment', entityId: { in: persistedShipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: persistedShipmentIds } } });
    }
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.customerAddress.deleteMany({ where: { customerId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
  });

  const shipmentBody = (shippingFeePayer?: string) => ({
    clientRequestId: randomUUID(),
    pickupAddressId,
    deliveryAddress: {
      contactName: 'Người nhận Phase E',
      phone: '0987654321',
      streetAddress: '2 Tràng Tiền',
      ward: 'Tràng Tiền',
      district: 'Hoàn Kiếm',
      city: 'Hà Nội',
    },
    package: {
      description: 'Kiện hàng Phase E',
      packageType: 'PARCEL',
      weightGrams: 1_001,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    },
    codAmount: 500_000,
    ...(shippingFeePayer ? { shippingFeePayer } : {}),
  });

  it('requires a valid explicit payer at the create boundary', async () => {
    await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(shipmentBody())
      .expect(400);

    await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(shipmentBody('THIRD_PARTY'))
      .expect(400);
  });

  it('creates SENDER and RECEIVER snapshots with identical pricing and separate COD', async () => {
    const senderBody = shipmentBody(ShippingFeePayer.SENDER);
    const senderResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(senderBody)
      .expect(201);
    senderShipment = bodyFrom<ShipmentPayload>(senderResponse).data;
    shipmentIds.push(senderShipment.id);

    const receiverResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(shipmentBody(ShippingFeePayer.RECEIVER))
      .expect(201);
    receiverShipment = bodyFrom<ShipmentPayload>(receiverResponse).data;
    shipmentIds.push(receiverShipment.id);

    expect(senderShipment.shippingFeePayer).toBe(ShippingFeePayer.SENDER);
    expect(receiverShipment.shippingFeePayer).toBe(ShippingFeePayer.RECEIVER);
    expect(senderShipment.totalFee).toBe(receiverShipment.totalFee);
    expect(senderShipment.codAmount).toBe(500_000);
    expect(receiverShipment.codAmount).toBe(500_000);
    expect(await prisma.cODTransaction.count({ where: { shipmentId: { in: shipmentIds } } })).toBe(
      0,
    );

    const persisted = await prisma.shipment.findMany({
      where: { id: { in: shipmentIds } },
      select: { id: true, shippingFeePayer: true, codAmount: true, totalFee: true },
    });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: senderShipment.id,
          shippingFeePayer: ShippingFeePayer.SENDER,
          codAmount: 500_000,
        }),
        expect.objectContaining({
          id: receiverShipment.id,
          shippingFeePayer: ShippingFeePayer.RECEIVER,
          codAmount: 500_000,
        }),
      ]),
    );

    const retryWithChangedPayer = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ ...senderBody, shippingFeePayer: ShippingFeePayer.RECEIVER })
      .expect(201);
    expect(bodyFrom<ShipmentPayload>(retryWithChangedPayer).data).toMatchObject({
      id: senderShipment.id,
      shippingFeePayer: ShippingFeePayer.SENDER,
    });
  });

  it('returns payer through owned, list, Dispatcher and Admin APIs with RBAC intact', async () => {
    const ownedResponse = await request(server)
      .get(`/api/v1/shipments/${receiverShipment.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<ShipmentPayload>(ownedResponse).data.shippingFeePayer).toBe(
      ShippingFeePayer.RECEIVER,
    );

    const listResponse = await request(server)
      .get('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .query({ page: 1, limit: 10 })
      .expect(200);
    const listed = bodyFrom<{ items: ShipmentPayload[] }>(listResponse).data.items;
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: receiverShipment.id,
          shippingFeePayer: ShippingFeePayer.RECEIVER,
        }),
      ]),
    );

    await request(server)
      .get(`/api/v1/shipments/${receiverShipment.id}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .expect(404);
    await request(server)
      .get(`/api/v1/dispatcher/shipments/${receiverShipment.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    for (const token of [dispatcherToken, adminToken]) {
      const operationalResponse = await request(server)
        .get(`/api/v1/dispatcher/shipments/${receiverShipment.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(bodyFrom<ShipmentPayload>(operationalResponse).data.shippingFeePayer).toBe(
        ShippingFeePayer.RECEIVER,
      );
    }
  });

  it('keeps payer and shipment snapshots unchanged after profile, address and pricing changes', async () => {
    await prisma.user.update({
      where: { id: customerId },
      data: { fullName: 'Phase E Customer Updated' },
    });
    await prisma.customerAddress.update({
      where: { id: pickupAddressId },
      data: { streetAddress: '99 Địa chỉ mới' },
    });

    const activeConfigResponse = await request(server)
      .get('/api/v1/pricing/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const activeConfig = bodyFrom<{
      baseFee: number;
      includedWeightGrams: number;
      extraWeightFeePerKg: number;
      codFeeBasisPoints: number;
    }>(activeConfigResponse).data;
    await request(server)
      .post('/api/v1/pricing/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseFee: activeConfig.baseFee + 1_000,
        includedWeightGrams: activeConfig.includedWeightGrams,
        extraWeightFeePerKg: activeConfig.extraWeightFeePerKg,
        codFeeBasisPoints: activeConfig.codFeeBasisPoints,
      })
      .expect(201);

    const historicalResponse = await request(server)
      .get(`/api/v1/shipments/${receiverShipment.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const historical = bodyFrom<ShipmentPayload>(historicalResponse).data;
    expect(historical).toMatchObject({
      shippingFeePayer: ShippingFeePayer.RECEIVER,
      totalFee: receiverShipment.totalFee,
      sender: { fullName: 'Phase E Customer' },
      pickup: { streetAddress: '1 Nguyễn Huệ' },
    });
  });
});
