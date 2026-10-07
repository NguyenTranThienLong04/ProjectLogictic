import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);
interface CodRow {
  id: string;
  shipmentId: string;
  status: string;
  expectedAmount: number;
  payout?: { status: string };
}
interface Page {
  items: CodRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  summary: unknown;
}
const body = <T>(response: Response) => (response.body as { data: T }).data;

describe('F05 COD pagination beyond 100 records (PostgreSQL + HTTP)', () => {
  const runId = randomUUID();
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const shipmentIds: string[] = [];
  const ownerCodIds = Array.from({ length: 105 }, () => randomUUID())
    .sort()
    .reverse();
  const otherCodIds: string[] = Array.from({ length: 7 }, () => randomUUID());
  let adminToken: string, driverToken: string, otherDriverToken: string, customerToken: string;
  let customerId: string, driverId: string, otherDriverId: string;
  const get = (path: string, token: string) =>
    request(server).get(`/api/v1/cod/${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, data: object = {}) =>
    request(server).post(`/api/v1/cod/${path}`).set('Authorization', `Bearer ${token}`).send(data);

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    const testDatabase =
      /^\/p0_regression_\d+$/.test(database.pathname) ||
      (process.env.CI === 'true' && database.pathname === '/i1_e2e');
    if (
      !['127.0.0.1', 'localhost'].includes(database.hostname) ||
      database.port !== '55432' ||
      !testDatabase
    ) {
      throw new Error('F05 requires an explicitly configured disposable local regression database');
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue({
        isAvailable: () => false,
        getClient: () => ({
          status: 'ready',
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          quit: jest.fn(),
        }),
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    const password = 'Password@123456';
    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const tokens: string[] = [];
    for (const [index, role] of [
      UserRole.ADMIN,
      UserRole.DRIVER,
      UserRole.DRIVER,
      UserRole.CUSTOMER,
    ].entries()) {
      const user = await prisma.user.create({
        data: {
          email: `f05-${index}-${runId}@example.test`,
          fullName: `F05 ${role}`,
          role,
          passwordHash,
        },
      });
      userIds.push(user.id);
      if (role === UserRole.DRIVER) {
        const driver = await prisma.driverProfile.create({
          data: {
            userId: user.id,
            employeeCode: `F05-${index}-${runId.slice(0, 8)}`,
            vehicleType: 'MOTORBIKE',
            vehiclePlate: 'F05-TEST',
          },
        });
        if (index === 1) driverId = driver.id;
        else otherDriverId = driver.id;
      }
      if (role === UserRole.CUSTOMER) customerId = user.id;
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);
      tokens.push(body<{ accessToken: string }>(login).accessToken);
    }
    [adminToken, driverToken, otherDriverToken, customerToken] = tokens;
    for (const [index, id] of [...ownerCodIds, ...otherCodIds].entries()) {
      const own = index < 105;
      const shipmentId = randomUUID();
      shipmentIds.push(shipmentId);
      await prisma.shipment.create({
        data: {
          id: shipmentId,
          trackingCode: `F05-${runId.slice(0, 8)}-${index}`,
          clientRequestId: randomUUID(),
          customerId,
          senderSnapshot: {},
          receiverSnapshot: {},
          pickupSnapshot: {},
          deliverySnapshot: {},
          packageSnapshot: {},
          pricingSnapshot: {},
          totalFee: 30_000,
          codAmount: 150_000,
          status: 'DELIVERED',
          codTransaction: {
            create: {
              id,
              status: 'COLLECTED',
              expectedAmount: 150_000,
              collectedAmount: 150_000,
              collectedByDriverId: own ? driverId : otherDriverId,
              collectedAt: new Date(),
              // Equal timestamps exercise the secondary id ordering; owner fixtures sort first.
              createdAt: new Date(own ? '2100-01-01T00:00:00Z' : '2099-01-01T00:00:00Z'),
            },
          },
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma && userIds.length) {
      const scope = { shipmentId: { in: shipmentIds } };
      await prisma.cODPayout.deleteMany({ where: { codTransaction: scope } });
      await prisma.cODRemittance.deleteMany({ where: { codTransaction: scope } });
      await prisma.cODTransaction.deleteMany({ where: scope });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('preserves legacy 100-item requests and explicit 20-item pages for both roles', async () => {
    for (const [endpoint, token, expectedIds] of [
      ['mine', driverToken, ownerCodIds],
      ['dashboard', adminToken, [...ownerCodIds, ...[...otherCodIds].sort().reverse()]],
    ] as const) {
      const legacy = body<Page>(await get(endpoint, token).expect(200));
      expect(legacy).toMatchObject({
        page: 1,
        limit: 100,
        total: expectedIds.length,
        totalPages: 2,
      });
      expect(legacy.items.map(({ id }) => id)).toEqual(expectedIds.slice(0, 100));
      const tail = body<Page>(await get(`${endpoint}?page=2`, token).expect(200));
      expect(tail.items.map(({ id }) => id)).toEqual(expectedIds.slice(100));
      const explicit = [];
      for (let page = 1; page <= Math.ceil(expectedIds.length / 20); page++) {
        const result = body<Page>(
          await get(`${endpoint}?page=${page}&limit=20`, token).expect(200),
        );
        expect(result.items).toHaveLength(Math.min(20, expectedIds.length - (page - 1) * 20));
        expect(result.summary).toEqual(legacy.summary);
        explicit.push(...result.items.map(({ id }) => id));
      }
      expect(explicit).toEqual(expectedIds);
      expect(new Set(explicit).size).toBe(expectedIds.length);
      expect(body<Page>(await get(`${endpoint}?limit=100`, token).expect(200)).items).toEqual(
        legacy.items,
      );
    }
  });

  it('lists all 105 owned transactions without overlap/gaps and keeps whole-dataset summaries', async () => {
    const pages: Page[] = [];
    for (const page of [1, 2, 3])
      pages.push(body<Page>(await get(`mine?page=${page}&limit=50`, driverToken).expect(200)));
    expect(pages.map((page) => page.items.length)).toEqual([50, 50, 5]);
    expect(pages[0]).toMatchObject({ page: 1, limit: 50, total: 105, totalPages: 3 });
    const ids = pages.flatMap((page) => page.items.map(({ id }) => id));
    expect(ids).toEqual(ownerCodIds);
    expect(new Set(ids).size).toBe(105);
    for (const page of pages) {
      expect(page.summary).toEqual([
        { status: 'COLLECTED', _sum: { expectedAmount: 15_750_000 }, _count: { _all: 105 } },
      ]);
      expect(page.items.every((item) => !('payout' in item))).toBe(true);
    }
    const adminPages = [];
    for (const page of [1, 2, 3])
      adminPages.push(
        body<Page>(await get(`dashboard?page=${page}&limit=50`, adminToken).expect(200)),
      );
    expect(adminPages.flatMap((page) => page.items.map(({ id }) => id)).slice(0, 105)).toEqual(
      ownerCodIds,
    );
    expect(adminPages[0].total).toBe(await prisma.cODTransaction.count());
    expect(adminPages[0].summary).toEqual(adminPages[2].summary);
    expect(body<Page>(await get('mine?page=4&limit=50', driverToken).expect(200)).items).toEqual(
      [],
    );
  });

  it('opens and processes record 105 through remit, confirm, settle, payout and customer confirmation', async () => {
    const lastPage = body<Page>(await get('mine?page=3&limit=50', driverToken).expect(200));
    const record = lastPage.items.at(-1)!;
    expect(record.id).toBe(ownerCodIds[104]);
    const input = { amount: record.expectedAmount, clientRequestId: randomUUID() };
    await post(`shipments/${record.shipmentId}/remit`, otherDriverToken, input).expect(404);
    const remittance = body<{ id: string }>(
      await post(`shipments/${record.shipmentId}/remit`, driverToken, input).expect(200),
    );
    expect(
      body<{ id: string }>(
        await post(`shipments/${record.shipmentId}/remit`, driverToken, input).expect(200),
      ).id,
    ).toBe(remittance.id);
    await post(`remittances/${remittance.id}/confirm`, adminToken, { expectedVersion: 0 }).expect(
      200,
    );
    const remitted = body<Page>(
      await get('dashboard?status=REMITTED&limit=50', adminToken).expect(200),
    );
    expect(remitted.items.some(({ id }) => id === record.id)).toBe(true);
    await post(`${record.id}/settle`, adminToken).expect(200);
    const unpaid = body<Page>(
      await get('dashboard?status=SETTLED&payoutStatus=NONE', adminToken).expect(200),
    );
    expect(unpaid.items.some(({ id }) => id === record.id)).toBe(true);
    const payout = body<{ id: string }>(
      await post(`${record.id}/payout`, adminToken, {
        amount: record.expectedAmount,
        method: 'BANK_TRANSFER',
        reference: 'F05-TEST-ONLY',
      }).expect(200),
    );
    expect(
      body<Page>(
        await get('dashboard?status=SETTLED&payoutStatus=PENDING', adminToken).expect(200),
      ).items.some(({ id }) => id === record.id),
    ).toBe(true);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'F05-TEST-ONLY',
    }).expect(200);
    expect(
      body<Page>(await get('dashboard?payoutStatus=SENT', adminToken).expect(200)).items.some(
        ({ id }) => id === record.id,
      ),
    ).toBe(true);
    await post(`payouts/${payout.id}/confirm`, customerToken, { expectedVersion: 1 }).expect(200);
    expect(
      body<Page>(await get('dashboard?payoutStatus=PAID_OUT', adminToken).expect(200)).items.some(
        ({ id }) => id === record.id,
      ),
    ).toBe(true);
    // These COD actions never create or mutate a Shipping Fee transaction.
    expect(
      await prisma.shippingFeeTransaction.count({ where: { shipmentId: record.shipmentId } }),
    ).toBe(0);
  });

  it('combines filters/pagination without changing totals, validates queries and preserves scopes', async () => {
    const all = body<Page>(await get('mine', driverToken).expect(200));
    const pages = await Promise.all(
      [1, 2, 3].map(async (page) =>
        body<Page>(
          await get(`mine?status=COLLECTED&page=${page}&limit=50`, driverToken).expect(200),
        ),
      ),
    );
    expect(pages[0].total).toBe(104);
    expect(pages.flatMap((page) => page.items.map(({ id }) => id))).toEqual(
      ownerCodIds.slice(0, 104),
    );
    expect(
      pages.every((page) => JSON.stringify(page.summary) === JSON.stringify(all.summary)),
    ).toBe(true);
    const other = body<Page>(await get('mine?status=COLLECTED', otherDriverToken).expect(200));
    expect(other.total).toBe(7);
    expect(other.items.every(({ id }) => otherCodIds.includes(id))).toBe(true);
    await get('mine?payoutStatus=PENDING', driverToken).expect(403);
    await get('mine', adminToken).expect(403);
    await get('mine', customerToken).expect(403);
    await get('dashboard', driverToken).expect(403);
    await get('dashboard', customerToken).expect(403);
    for (const query of [
      'page=0',
      'page=1.5',
      'limit=101',
      'limit=0',
      'status=INVALID',
      'payoutStatus=INVALID',
    ]) {
      await get(`dashboard?${query}`, adminToken).expect(400);
    }
    const none = body<Page>(
      await get('dashboard?status=COLLECTED&payoutStatus=SENT', adminToken).expect(200),
    );
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
    const full = body<Page>(await get('dashboard', adminToken).expect(200));
    expect(none.summary).toEqual(full.summary);
  });
});
