import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole, type WarehouseTransferStatus } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { WarehouseTransferFlowPolicy } from '../src/modules/warehouses/warehouse-transfer-flow.policy.js';
import { ConfigService } from '@nestjs/config';
import { assertDisposablePostgresDatabase } from './disposable-database.js';

jest.setTimeout(120_000);
interface TransferRow {
  id: string;
  shipmentId: string;
  transferCode: string;
  status: string;
}
interface TransferPage {
  items: TransferRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
const body = <T>(response: Response) => (response.body as { data: T }).data;

describe('F07 warehouse transfer pagination (PostgreSQL + HTTP)', () => {
  let app: INestApplication, server: Server, prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const warehouses = Array.from({ length: 4 }, () => randomUUID());
  const users: string[] = [],
    shipments: string[] = [];
  const ids = Array.from({ length: 105 }, () => randomUUID())
    .sort()
    .reverse();
  const tokens: string[] = [];
  const [origin, destination, unrelated, fourth] = warehouses;
  const get = (warehouse: string, path: string, token = tokens[1]) =>
    request(server)
      .get(`/api/v1/warehouses/${warehouse}/${path}`)
      .set('Authorization', `Bearer ${token}`);
  const receive = (warehouse: string, id: string, token: string) =>
    request(server)
      .post(`/api/v1/warehouses/${warehouse}/transfers/${id}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

  beforeAll(async () => {
    assertDisposablePostgresDatabase(process.env);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WarehouseTransferFlowPolicy)
      .useValue(
        new WarehouseTransferFlowPolicy(
          new ConfigService({ LINE_HAUL_ENFORCEMENT_FROM: '2026-01-01T00:00:00.000Z' }),
        ),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    await prisma.warehouse.createMany({
      data: warehouses.map((id, index) => ({
        id,
        code: `F07-${suffix}-${index}`,
        name: `F07 ${index}`,
        address: 'Test',
        city: 'Test',
      })),
    });
    const password = 'F07@Test123456';
    const passwordHash = await app.get(PasswordHasherService).hash(password);
    for (const [index, role] of [
      UserRole.ADMIN,
      UserRole.WAREHOUSE_STAFF,
      UserRole.WAREHOUSE_STAFF,
      UserRole.WAREHOUSE_STAFF,
      UserRole.DISPATCHER,
      UserRole.CUSTOMER,
      UserRole.DRIVER,
    ].entries()) {
      const user = await prisma.user.create({
        data: {
          role,
          passwordHash,
          fullName: `F07 ${index}`,
          email: `f07-${suffix}-${index}@example.test`,
        },
      });
      users.push(user.id);
      if (role === UserRole.WAREHOUSE_STAFF)
        await prisma.warehouseStaffProfile.create({
          data: {
            userId: user.id,
            warehouseId: warehouses[index - 1],
            staffCode: `F07-${suffix}-${index}`,
          },
        });
      tokens.push(
        body<{ accessToken: string }>(
          await request(server)
            .post('/api/v1/auth/login')
            .send({ email: user.email, password })
            .expect(200),
        ).accessToken,
      );
    }
    for (const [index, id] of [
      ...ids,
      ...Array.from({ length: 10 }, () => randomUUID()),
    ].entries()) {
      const own = index < 108;
      const status: WarehouseTransferStatus =
        index < 105 || !own
          ? 'IN_TRANSIT'
          : index === 105
            ? 'PENDING'
            : index === 106
              ? 'COMPLETED'
              : 'CANCELLED';
      const shipmentId = randomUUID();
      shipments.push(shipmentId);
      await prisma.shipment.create({
        data: {
          id: shipmentId,
          trackingCode: `F07-${suffix}-SHP-${index}`,
          clientRequestId: randomUUID(),
          customerId: users[5],
          senderSnapshot: {},
          receiverSnapshot: {},
          pickupSnapshot: {},
          deliverySnapshot: {},
          packageSnapshot: {},
          pricingSnapshot: {},
          totalFee: 30000,
          codAmount: 0,
          status:
            status === 'IN_TRANSIT'
              ? 'IN_TRANSIT'
              : status === 'COMPLETED'
                ? 'AT_DESTINATION_WAREHOUSE'
                : 'AT_ORIGIN_WAREHOUSE',
          originWarehouseId: own ? origin : unrelated,
          destinationWarehouseId: own ? destination : fourth,
          currentWarehouseId:
            status === 'IN_TRANSIT' ? null : status === 'COMPLETED' ? destination : origin,
          transfers: {
            create: {
              id,
              transferCode: `F07-${suffix}-TRF-${index}`,
              fromWarehouseId: own ? origin : unrelated,
              toWarehouseId: own ? destination : fourth,
              createdById: users[1],
              clientRequestId: randomUUID(),
              status,
              createdAt: new Date('2025-12-01T00:00:00Z'),
              dispatchedAt:
                status === 'IN_TRANSIT' || status === 'COMPLETED'
                  ? new Date('2025-12-02T00:00:00Z')
                  : null,
            },
          },
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({ where: { userId: { in: users } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipments } } });
      await prisma.warehouseTransfer.deleteMany({ where: { shipmentId: { in: shipments } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipments } } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: users } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.warehouse.deleteMany({ where: { id: { in: warehouses } } });
    }
    await app?.close();
  });

  it('traverses all 105 equal-timestamp records without duplicates in both directions and all scope', async () => {
    for (const [warehouse, direction, token] of [
      [origin, 'outbound', tokens[1]],
      [destination, 'inbound', tokens[2]],
      [origin, 'all', tokens[1]],
    ]) {
      const collected: string[] = [];
      for (let page = 1; page <= 6; page++) {
        const result = body<TransferPage>(
          await get(
            warehouse,
            `transfers?direction=${direction}&status=IN_TRANSIT&page=${page}&limit=20`,
            token,
          ).expect(200),
        );
        expect(result).toMatchObject({ page, limit: 20, total: 105, totalPages: 6 });
        collected.push(...result.items.map((row) => row.id));
      }
      expect(collected).toEqual(ids);
      expect(new Set(collected).size).toBe(105);
    }
    const tail = body<TransferPage>(
      await get(origin, 'transfers?status=IN_TRANSIT&limit=100&page=2').expect(200),
    );
    expect(tail.items.map((row) => row.id)).toEqual(ids.slice(100));
    expect(
      body<TransferPage>(await get(origin, 'transfers?direction=inbound').expect(200)).total,
    ).toBe(0);
  });

  it('paginates incoming queue with stable oldest-dispatch order and full scoped count', async () => {
    const collected: string[] = [];
    for (let page = 1; page <= 6; page++) {
      const result = body<{ incomingTransfers: TransferPage }>(
        await get(destination, `inbound-queue?page=${page}`, tokens[2]).expect(200),
      ).incomingTransfers;
      expect(result).toMatchObject({ page, limit: 20, total: 105, totalPages: 6 });
      collected.push(...result.items.map((row) => row.id));
    }
    expect(collected).toEqual([...ids].reverse());
    const filtered = body<{ incomingTransfers: TransferPage }>(
      await get(destination, `inbound-queue?search=f07-${suffix}-shp-104`, tokens[2]).expect(200),
    ).incomingTransfers;
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(ids[104]);
  });

  it('filters codes, exact shipment and statuses before pagination, with empty and out-of-range metadata', async () => {
    for (const search of [`f07-${suffix}-trf-104`, `F07-${suffix}-SHP-104`]) {
      const result = body<TransferPage>(
        await get(origin, `transfers?search=${search}&status=IN_TRANSIT`).expect(200),
      );
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe(ids[104]);
    }
    const exact = body<TransferPage>(
      await get(origin, `transfers?shipmentId=${shipments[104]}`).expect(200),
    );
    expect(exact.items.map((row) => row.id)).toEqual([ids[104]]);
    for (const status of ['PENDING', 'COMPLETED', 'CANCELLED']) {
      expect(
        body<TransferPage>(await get(origin, `transfers?status=${status}`).expect(200)).total,
      ).toBe(1);
    }
    expect(
      body<TransferPage>(await get(origin, 'transfers?search=does-not-exist').expect(200)),
    ).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(
      body<TransferPage>(await get(origin, 'transfers?status=IN_TRANSIT&page=99').expect(200)),
    ).toMatchObject({ items: [], page: 99, total: 105, totalPages: 6 });
  });

  it('rejects invalid filters and page bounds on both HTTP endpoints', async () => {
    for (const endpoint of ['transfers', 'inbound-queue']) {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'page=NaN',
        'page=21474837',
        'limit=0',
        'limit=101',
        'limit=1.5',
        'search=' + 'x'.repeat(101),
      ]) {
        await get(origin, `${endpoint}?${query}`).expect(400);
      }
    }
    for (const query of ['direction=invalid', 'status=INVALID', 'shipmentId=invalid'])
      await get(origin, `transfers?${query}`).expect(400);
    await get(origin, 'inbound-queue?status=COMPLETED').expect(400);
  });

  it('exposes active transfer per inventory shipment independently of transfer pagination', async () => {
    const result = body<{
      items: { id: string; activeTransfer: { transferCode: string; status: string } | null }[];
    }>(await get(origin, `shipments?search=F07-${suffix}-SHP-105`).expect(200));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].activeTransfer).toMatchObject({
      transferCode: `F07-${suffix}-TRF-105`,
      status: 'PENDING',
    });
  });

  it('preserves RBAC and warehouse scope even with search, direction and shipment filters', async () => {
    for (const path of ['transfers', 'inbound-queue']) {
      await request(server).get(`/api/v1/warehouses/${origin}/${path}`).expect(401);
      for (const token of [tokens[5], tokens[6]]) await get(origin, path, token).expect(403);
      await get(origin, path, tokens[3]).expect(403);
      for (const token of [tokens[0], tokens[4]]) await get(origin, path, token).expect(200);
    }
    expect(
      body<TransferPage>(await get(origin, `transfers?search=TRF-114&direction=all`).expect(200))
        .total,
    ).toBe(0);
    expect(
      body<TransferPage>(await get(origin, `transfers?shipmentId=${shipments[114]}`).expect(200))
        .total,
    ).toBe(0);
    await get(origin, `transfers/${ids[100]}`, tokens[3]).expect(403);
    await get(unrelated, `transfers/${ids[100]}`, tokens[3]).expect(404);
  });

  it('opens and receives record 101 with ownership, retry and append-only history preserved', async () => {
    const id = ids[100];
    const tail = body<TransferPage>(
      await get(destination, 'transfers?status=IN_TRANSIT&page=6', tokens[2]).expect(200),
    );
    expect(tail.items[0].id).toBe(id);
    expect(
      body<TransferRow>(await get(destination, `transfers/${id}`, tokens[2]).expect(200)).id,
    ).toBe(id);
    await receive(origin, id, tokens[1]).expect(403);
    await receive(destination, id, tokens[3]).expect(403);
    await receive(destination, id, tokens[2]).expect(200);
    await receive(destination, id, tokens[2]).expect(200);
    expect(await prisma.shipment.findUnique({ where: { id: shipments[100] } })).toMatchObject({
      status: 'AT_DESTINATION_WAREHOUSE',
      currentWarehouseId: destination,
      version: 1,
    });
    expect(await prisma.warehouseTransfer.findUnique({ where: { id } })).toMatchObject({
      status: 'COMPLETED',
      receivedById: users[2],
    });
    expect(
      await prisma.trackingEvent.count({
        where: { shipmentId: shipments[100], type: 'WAREHOUSE_TRANSFER_RECEIVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: id, action: 'WAREHOUSE_TRANSFER_RECEIVED' },
      }),
    ).toBe(1);
    expect(
      body<{ incomingTransfers: TransferPage }>(
        await get(destination, 'inbound-queue', tokens[2]).expect(200),
      ).incomingTransfers.total,
    ).toBe(104);
  });
});
