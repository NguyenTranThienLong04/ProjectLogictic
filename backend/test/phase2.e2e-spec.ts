import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ShipmentStatus } from '../src/generated/prisma/client.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(60_000);

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
  meta: Record<string, unknown>;
}

interface AuthPayload {
  accessToken: string;
}

interface AddressPayload {
  id: string;
  isDefault: boolean;
}

interface QuotePayload {
  baseFee: number;
  weightFee: number;
  codFee: number;
  totalFee: number;
}

interface ShipmentPayload {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  totalFee: number;
  timeline: Array<{ type: string }>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error('API response envelope is missing');
  }
  return body as ApiEnvelope<T>;
}

describe('Phase 2 customer shipment flow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const runId = randomUUID().replaceAll('-', '');
  const firstEmail = `phase2-a-${runId}@example.com`;
  const secondEmail = `phase2-b-${runId}@example.com`;
  const emails = [firstEmail, secondEmail];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
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

    if (shipmentIds.length) {
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.auditLog.deleteMany({
        where: { entityType: 'Shipment', entityId: { in: shipmentIds } },
      });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
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

  it('quotes, creates idempotently, scopes ownership, tracks and cancels', async () => {
    const firstRegister = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: firstEmail,
        fullName: 'Customer Phase Two A',
        phone: '0901234567',
        password: 'CustomerPass!123',
      })
      .expect(201);
    const secondRegister = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: secondEmail,
        fullName: 'Customer Phase Two B',
        phone: '0912345678',
        password: 'CustomerPass!123',
      })
      .expect(201);
    const firstToken = bodyFrom<AuthPayload>(firstRegister).data.accessToken;
    const secondToken = bodyFrom<AuthPayload>(secondRegister).data.accessToken;

    const addressResponse = await request(server)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({
        label: 'Nhà riêng',
        contactName: 'Customer Phase Two A',
        phone: '0901234567',
        streetAddress: '1 Lê Lợi',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
      })
      .expect(201);
    const address = bodyFrom<AddressPayload>(addressResponse).data;
    expect(address.isDefault).toBe(true);

    const deliveryAddress = {
      contactName: 'Người nhận E2E',
      phone: '0987654321',
      streetAddress: '2 Tràng Tiền',
      ward: 'Tràng Tiền',
      district: 'Hoàn Kiếm',
      city: 'Hà Nội',
    };
    const packageData = {
      description: 'Kiện hàng E2E',
      packageType: 'PARCEL',
      weightGrams: 1001,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    };
    const quoteResponse = await request(server)
      .post('/api/v1/pricing/quote')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({
        pickup: {
          contactName: 'Customer Phase Two A',
          phone: '0901234567',
          streetAddress: '1 Lê Lợi',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        },
        delivery: deliveryAddress,
        packageType: packageData.packageType,
        weightGrams: packageData.weightGrams,
        lengthCm: packageData.lengthCm,
        widthCm: packageData.widthCm,
        heightCm: packageData.heightCm,
        codAmount: 100001,
      })
      .expect(200);
    const quote = bodyFrom<QuotePayload>(quoteResponse).data;
    expect(quote).toMatchObject({
      baseFee: 30000,
      weightFee: 5000,
      codFee: 501,
      totalFee: 35501,
    });

    const clientRequestId = crypto.randomUUID();
    const createBody = {
      clientRequestId,
      pickupAddressId: address.id,
      deliveryAddress,
      package: packageData,
      codAmount: 100001,
      shippingFeePayer: 'SENDER',
    };
    const createResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${firstToken}`)
      .send(createBody)
      .expect(201);
    const shipment = bodyFrom<ShipmentPayload>(createResponse).data;
    expect(shipment.totalFee).toBe(35501);
    expect(shipment.timeline).toHaveLength(1);

    const duplicateResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${firstToken}`)
      .send(createBody)
      .expect(201);
    const duplicate = bodyFrom<ShipmentPayload>(duplicateResponse).data;
    expect(duplicate.id).toBe(shipment.id);
    expect(duplicate.timeline).toHaveLength(1);

    await request(server)
      .get(`/api/v1/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(404);

    const publicTracking = await request(server)
      .get(`/api/v1/tracking/${shipment.trackingCode}`)
      .expect(200);
    expect(publicTracking.body).not.toHaveProperty('data.customerId');
    expect(publicTracking.body).not.toHaveProperty('data.receiver');

    const cancelResponse = await request(server)
      .post(`/api/v1/shipments/${shipment.id}/cancel`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ reason: 'Không còn nhu cầu gửi' })
      .expect(200);
    const cancelled = bodyFrom<ShipmentPayload>(cancelResponse).data;
    expect(cancelled.status).toBe(ShipmentStatus.CANCELLED);
    expect(cancelled.timeline).toHaveLength(2);

    await request(server)
      .post(`/api/v1/shipments/${shipment.id}/cancel`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ reason: 'Thử hủy lại' })
      .expect(409);
  });
});
