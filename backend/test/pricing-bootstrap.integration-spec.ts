import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { UserRole } from '../src/generated/prisma/client.js';

jest.setTimeout(60_000);

function payload(response: Response): { data: Record<string, unknown>; code?: string } {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object') throw new Error('Expected JSON response');
  return body as { data: Record<string, unknown>; code?: string };
}

describe('Pricing bootstrap on an isolated empty database (explicit integration runner)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/^\/pricing_bootstrap_\d+$/.test(url.pathname)
    ) {
      throw new Error('Requires a dedicated localhost pricing_bootstrap_<timestamp> database');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        getClient: () => ({
          status: 'ready',
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          quit: jest.fn(),
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    // Only remove the migration seed in this guarded disposable, unused database.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.shipment.count()).toBe(0);
    await prisma.pricingConfig.deleteMany();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('fails clearly before config, creates via Admin, reloads, quotes, creates shipment and audits', async () => {
    const policy = {
      baseFee: 30000,
      includedWeightGrams: 1000,
      extraWeightFeePerKg: 5000,
      codFeeBasisPoints: 50,
    };
    const credentials = { email: 'pricing-admin@example.test', password: 'PricingBootstrap!123' };
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...credentials, fullName: 'Pricing Admin', phone: '0901234567' })
      .expect(201);
    const admin = await prisma.user.update({
      where: { email: credentials.email },
      data: { role: UserRole.ADMIN },
    });
    const login = await request(server).post('/api/v1/auth/login').send(credentials).expect(200);
    const adminToken = String(payload(login).data.accessToken);
    const customer = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'pricing-customer@example.test',
        password: 'PricingBootstrap!123',
        fullName: 'Pricing Customer',
        phone: '0901234567',
      })
      .expect(201);
    const token = String(payload(customer).data.accessToken);
    const address = {
      contactName: 'Pricing Customer',
      phone: '0901234567',
      streetAddress: '123 Nguyễn Trãi',
      ward: 'Bến Thành',
      district: '',
      city: 'Hồ Chí Minh',
    };
    const saved = await request(server)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send({ ...address, label: 'Pricing bootstrap test' })
      .expect(201);
    const packageData = {
      packageType: 'PARCEL',
      weightGrams: 1001,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    };
    const quote = { pickup: address, delivery: address, ...packageData, codAmount: 100001 };
    const shipmentInput = {
      clientRequestId: randomUUID(),
      pickupAddressId: payload(saved).data.id as string,
      deliveryAddress: address,
      package: { ...packageData, description: 'Pricing bootstrap test' },
      codAmount: 100001,
      shippingFeePayer: 'SENDER',
    };
    for (const response of [
      await request(server).get('/api/v1/pricing/config').auth(adminToken, { type: 'bearer' }),
      await request(server)
        .post('/api/v1/pricing/quote')
        .auth(token, { type: 'bearer' })
        .send(quote),
      await request(server)
        .post('/api/v1/shipments')
        .auth(token, { type: 'bearer' })
        .send(shipmentInput),
    ]) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'PRICING_CONFIG_UNAVAILABLE',
        message: 'Chưa có cấu hình giá vận chuyển đang hoạt động. Vui lòng liên hệ quản trị viên.',
      });
    }
    expect(await prisma.pricingConfig.count()).toBe(0);
    expect(await prisma.shipment.count()).toBe(0);
    await request(server)
      .post('/api/v1/pricing/config')
      .auth(token, { type: 'bearer' })
      .send(policy)
      .expect(403);
    await request(server)
      .post('/api/v1/pricing/config')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...policy, includedWeightGrams: 0 })
      .expect(400);
    expect(await prisma.pricingConfig.count()).toBe(0);
    const created = await request(server)
      .post('/api/v1/pricing/config')
      .auth(adminToken, { type: 'bearer' })
      .send(policy)
      .expect(201);
    expect(payload(created).data).toMatchObject({
      ...policy,
      version: 1,
      isActive: true,
      distanceFee: 0,
      surcharge: 0,
      discount: 0,
    });
    const reload = await request(server)
      .get('/api/v1/pricing/config')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(payload(reload).data).toEqual(payload(created).data);
    const quoted = await request(server)
      .post('/api/v1/pricing/quote')
      .auth(token, { type: 'bearer' })
      .send(quote)
      .expect(200);
    expect(payload(quoted).data).toMatchObject({
      configVersion: 1,
      totalFee: 35501,
      weightFee: 5000,
      codFee: 501,
    });
    const shipment = await request(server)
      .post('/api/v1/shipments')
      .auth(token, { type: 'bearer' })
      .send(shipmentInput)
      .expect(201);
    expect(payload(shipment).data).toMatchObject({ status: 'PENDING', totalFee: 35501 });
    const audits = await prisma.auditLog.findMany({ where: { action: 'PRICING_CONFIG_ACTIVATE' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: admin.id,
      actorRole: 'ADMIN',
      entityId: payload(created).data.id as string,
      after: { ...policy, version: 1 },
    });
    // An inactive historical config must also allow bootstrap without losing history.
    await prisma.pricingConfig.update({
      where: { id: payload(created).data.id as string },
      data: { isActive: false },
    });
    const inactive = await request(server)
      .get('/api/v1/pricing/config')
      .auth(adminToken, { type: 'bearer' })
      .expect(503);
    expect(payload(inactive).code).toBe('PRICING_CONFIG_UNAVAILABLE');
    const next = await request(server)
      .post('/api/v1/pricing/config')
      .auth(adminToken, { type: 'bearer' })
      .send(policy)
      .expect(201);
    expect(payload(next).data).toMatchObject({ version: 2, isActive: true });
    expect(await prisma.pricingConfig.count()).toBe(2);
    expect(await prisma.pricingConfig.count({ where: { isActive: true } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'PRICING_CONFIG_ACTIVATE' } })).toBe(2);
  });
});
