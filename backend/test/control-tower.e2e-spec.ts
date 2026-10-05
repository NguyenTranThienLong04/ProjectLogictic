import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ShipmentStatus, UserRole } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { ControlTowerQueryDto } from '../src/modules/dashboards/control-tower-query.dto.js';
import { controlTowerPolicy } from '../src/modules/dashboards/control-tower.policy.js';
import { controlTowerQuery } from '../src/modules/dashboards/control-tower.query.js';
import type { ControlTowerSnapshot } from '../src/modules/dashboards/control-tower.response.js';

jest.setTimeout(120000);

describe('Control Tower PostgreSQL / HTTP', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const tokens = new Map<UserRole, string>();
  const run = `CT${randomUUID().slice(0, 8)}`;
  const now = new Date('2026-10-06T12:00:00.000Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000);
  let actorId: string;
  let customerId: string;
  let warehouseId: string;
  let destinationId: string;
  let tripId: string;
  let transferId: string;
  const ids: Record<string, string> = {};

  async function snapshot(input: Partial<ControlTowerQueryDto> = {}) {
    const query = Object.assign(new ControlTowerQueryDto(), { search: run }, input);
    return (
      await prisma.$queryRaw<ControlTowerSnapshot[]>(
        controlTowerQuery(query, controlTowerPolicy(app.get(ConfigService)), now),
      )
    )[0];
  }
  async function shipment(
    key: string,
    status: ShipmentStatus,
    events: Array<[ShipmentStatus, number]> = [],
    extra = {},
  ) {
    const row = await prisma.shipment.create({
      data: {
        trackingCode: `${run}-${key}`,
        clientRequestId: randomUUID(),
        customerId,
        status,
        senderSnapshot: {},
        receiverSnapshot: {},
        pickupSnapshot: {},
        deliverySnapshot: {},
        packageSnapshot: { weightGrams: 1000 },
        pricingSnapshot: {},
        totalFee: 30000,
        originWarehouseId: warehouseId,
        destinationWarehouseId: destinationId,
        createdAt: ago(10000),
        ...extra,
        trackingEvents: {
          create: events.map(([eventStatus, minutes]) => ({
            status: eventStatus,
            type: 'TEST_TRANSITION',
            title: 'Test transition',
            createdAt: ago(minutes),
          })),
        },
      },
    });
    ids[key] = row.id;
    return row;
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/p0_regression_')
    ) {
      throw new Error(
        'Run only through backend/test/p0-local.mjs against its disposable localhost database',
      );
    }
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    const password = 'ControlTowerTest@2026';
    const passwordHash = await app.get(PasswordHasherService).hash(password);
    for (const role of Object.values(UserRole)) {
      const email = `${run}-${role}@example.com`.toLowerCase();
      const user = await prisma.user.create({
        data: {
          email,
          fullName: `Tower ${role}`,
          role,
          passwordHash,
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      });
      if (role === 'ADMIN') actorId = user.id;
      if (role === 'CUSTOMER') customerId = user.id;
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      tokens.set(role, (response.body as { data: { accessToken: string } }).data.accessToken);
    }
    for (const kind of ['origin', 'destination']) {
      const warehouse = await prisma.warehouse.create({
        data: { code: `${run}-${kind}`, name: kind, city: 'Test', address: 'Test' },
      });
      if (kind === 'origin') warehouseId = warehouse.id;
      else destinationId = warehouse.id;
    }
    await shipment('ontime', 'AT_ORIGIN_WAREHOUSE', [
      ['PICKED_UP', 900],
      ['AT_ORIGIN_WAREHOUSE', 100],
    ]);
    await shipment('risk', 'AT_ORIGIN_WAREHOUSE', [['AT_ORIGIN_WAREHOUSE', 576]]);
    await shipment('overdue', 'AT_ORIGIN_WAREHOUSE', [['AT_ORIGIN_WAREHOUSE', 720]]);
    await shipment('missing', 'AT_ORIGIN_WAREHOUSE');
    await shipment('future', 'AT_ORIGIN_WAREHOUSE', [['AT_ORIGIN_WAREHOUSE', -5]]);
    await shipment('inconsistent', 'AT_ORIGIN_WAREHOUSE', [
      ['AT_ORIGIN_WAREHOUSE', 60],
      ['IN_TRANSIT', 30],
    ]);
    await shipment(
      'pickup',
      'PICKUP_ASSIGNED',
      [
        ['CONFIRMED', 480],
        ['PICKUP_ASSIGNED', 470],
        ['AWAITING_PICKUP_ASSIGNMENT', 20],
        ['PICKUP_ASSIGNED', 5],
      ],
      { confirmedAt: ago(480) },
    );
    await shipment('failed', 'DELIVERY_FAILED', [
      ['OUT_FOR_DELIVERY', 400],
      ['DELIVERY_FAILED', 20],
    ]);
    await shipment('retry', 'OUT_FOR_DELIVERY', [
      ['OUT_FOR_DELIVERY', 900],
      ['DELIVERY_FAILED', 800],
      ['AWAITING_DELIVERY_ASSIGNMENT', 500],
      ['DELIVERY_ASSIGNED', 200],
      ['OUT_FOR_DELIVERY', 10],
    ]);
    await shipment('destination', 'DELIVERY_ASSIGNED', [
      ['AT_DESTINATION_WAREHOUSE', 600],
      ['AWAITING_DELIVERY_ASSIGNMENT', 500],
      ['DELIVERY_ASSIGNED', 100],
    ]);
    await shipment('pending', 'PENDING', [], { createdAt: ago(15) });
    await shipment('terminal', 'DELIVERED', [['DELIVERED', 10]]);
    const transit = await shipment('transit', 'IN_TRANSIT', [
      ['AT_ORIGIN_WAREHOUSE', 1600],
      ['IN_TRANSIT', 1450],
    ]);
    const transfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `${run}-TRF`,
        shipmentId: transit.id,
        fromWarehouseId: warehouseId,
        toWarehouseId: destinationId,
        status: 'IN_TRANSIT',
        clientRequestId: randomUUID(),
        createdById: actorId,
        createdAt: ago(1500),
        dispatchedAt: ago(1450),
      },
    });
    transferId = transfer.id;
    const driverUser = await prisma.user.create({
      data: {
        email: `${run}-trip-driver@example.com`,
        fullName: 'Trip driver',
        passwordHash,
        role: 'DRIVER',
      },
    });
    const driver = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        employeeCode: `${run}-DRV`,
        capabilities: ['LINE_HAUL'],
        vehicleType: 'TRUCK',
        vehiclePlate: `${run}-LAST`,
      },
    });
    const vehicle = await prisma.lineHaulVehicle.create({
      data: {
        vehicleCode: `${run}-VEH`,
        licensePlate: `${run}-PLATE`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: 100000,
      },
    });
    const trip = await prisma.lineHaulTrip.create({
      data: {
        tripCode: `${run}-TRIP`,
        clientRequestId: randomUUID(),
        originWarehouseId: warehouseId,
        destinationWarehouseId: destinationId,
        driverId: driver.id,
        vehicleId: vehicle.id,
        status: 'IN_TRANSIT',
        createdById: actorId,
        createdAt: ago(1500),
        departedAt: ago(1450),
        transferAssignments: {
          create: { warehouseTransferId: transfer.id, assignedById: actorId },
        },
      },
    });
    tripId = trip.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('uses exact inclusive SLA boundaries, backend aging and priority with no terminal/double counted shipments', async () => {
    const result = await snapshot();
    const find = (key: string) => result.items.find((item) => item.id === ids[key])!;
    expect(find('ontime')).toMatchObject({
      slaState: 'ON_TIME',
      agingSeconds: 6000,
      timestampQuality: 'VALID',
    });
    expect(find('risk')).toMatchObject({ slaState: 'AT_RISK', agingSeconds: 576 * 60 });
    expect(find('overdue')).toMatchObject({ slaState: 'OVERDUE', agingSeconds: 720 * 60 });
    expect(new Date(find('overdue').deadline!).toISOString()).toBe(now.toISOString());
    expect(result.summary.activeShipments).toBe(12);
    expect(result.summary.activeTrips).toBe(1);
    expect(result.items.some((item) => item.id === ids.terminal)).toBe(false);
    expect(result.items.map((item) => item.priority)).toEqual(
      [...result.items.map((item) => item.priority)].sort(),
    );
    expect(find('transit')).toMatchObject({
      transferId,
      tripId,
      timestampSource: 'LIFECYCLE',
      slaState: 'OVERDUE',
    });
  });

  it('does not reset on reassignment/same-stage events, resets on stage entry and redelivery', async () => {
    const result = await snapshot();
    const find = (key: string) => result.items.find((item) => item.id === ids[key])!;
    expect(find('pickup')).toMatchObject({ agingSeconds: 480 * 60, slaState: 'OVERDUE' });
    expect(find('destination')).toMatchObject({ agingSeconds: 600 * 60, slaState: 'AT_RISK' });
    expect(find('retry')).toMatchObject({ agingSeconds: 600, slaState: 'ON_TIME' });
    expect(find('failed')).toMatchObject({
      agingSeconds: 1200,
      exception: 'DELIVERY_FAILED',
      slaState: null,
    });
    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: ids.ontime },
        data: { status: 'AWAITING_DELIVERY_ASSIGNMENT' },
      });
      await tx.trackingEvent.create({
        data: {
          shipmentId: ids.ontime,
          status: 'AWAITING_DELIVERY_ASSIGNMENT',
          type: 'READY_FOR_DELIVERY',
          title: 'Ready',
          createdAt: ago(2),
        },
      });
    });
    const changed = (await snapshot()).items.find((item) => item.id === ids.ontime)!;
    expect(changed).toMatchObject({
      stage: 'DESTINATION_DWELL',
      agingSeconds: 120,
      slaState: 'ON_TIME',
    });
  });

  it('never reports unknown or inconsistent timestamps as on time or zero aging', async () => {
    const result = await snapshot();
    for (const key of ['missing', 'future', 'inconsistent']) {
      expect(result.items.find((item) => item.id === ids[key])).toMatchObject({
        slaState: null,
        agingSeconds: null,
        stageStartedAt: null,
        deadline: null,
      });
    }
    expect(result.items.find((item) => item.id === ids.future)?.exception).toBe(
      'TIMESTAMP_INCONSISTENT',
    );
    expect(result.items.find((item) => item.id === ids.pending)).toMatchObject({
      slaState: null,
      agingSeconds: 900,
      exception: null,
    });
  });

  it('filters warehouse, entity, status, SLA, exception, search and half-open created dates in SQL', async () => {
    expect((await snapshot({ warehouseId: randomUUID() })).total).toBe(0);
    expect(
      (await snapshot({ warehouseId: destinationId, entityType: 'TRIP' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([tripId]);
    expect(
      (await snapshot({ status: 'PICKUP_ASSIGNED', slaState: 'OVERDUE' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([ids.pickup]);
    expect((await snapshot({ exceptionsOnly: 'true' })).items.every((item) => item.exception)).toBe(
      true,
    );
    expect((await snapshot({ search: `${run}-TRIP` })).total).toBe(2);
    expect(
      (await snapshot({ from: ago(15).toISOString(), to: now.toISOString() })).items.map(
        (item) => item.id,
      ),
    ).toEqual([ids.pending]);
    expect((await snapshot({ to: ago(10000).toISOString() })).total).toBe(0);
    expect((await snapshot({ search: "'; DROP TABLE Shipment; --" })).total).toBe(0);
  });

  it('paginates/sorts deterministically and preserves totals on an empty last page', async () => {
    const whole = await snapshot({ sort: 'CODE_ASC' });
    const one = await snapshot({ limit: 2, page: 1, sort: 'CODE_ASC' });
    const two = await snapshot({ limit: 2, page: 2, sort: 'CODE_ASC' });
    expect([...one.items, ...two.items].map((item) => item.id)).toEqual(
      whole.items.slice(0, 4).map((item) => item.id),
    );
    expect(one.summary).toEqual(whole.summary);
    expect((await snapshot({ page: 999 })).items).toEqual([]);
    expect((await snapshot({ page: 999 })).total).toBe(whole.total);
    const aging = await snapshot({ sort: 'AGING_DESC' });
    expect(aging.items[0].agingSeconds).toBe(1450 * 60);
  });

  it('enforces real auth/RBAC on both tower endpoints, validates HTTP and opens exact scoped transfer', async () => {
    for (const path of ['/api/v1/control-tower', '/api/v1/control-tower/filters']) {
      await request(server).get(path).expect(401);
      for (const [role, token] of tokens) {
        await request(server)
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(['ADMIN', 'DISPATCHER'].includes(role) ? 200 : 403);
      }
    }
    const admin = `Bearer ${tokens.get('ADMIN')}`;
    for (const query of [
      { limit: 101 },
      { warehouseId: 'bad' },
      { sort: 'unsafe' },
      { now: now.toISOString() },
      { from: now.toISOString(), to: ago(1).toISOString() },
    ]) {
      await request(server)
        .get('/api/v1/control-tower')
        .set('Authorization', admin)
        .query(query)
        .expect(400);
    }
    const path = `/api/v1/warehouses/${warehouseId}/transfers/${transferId}`;
    const detail = await request(server).get(path).set('Authorization', admin).expect(200);
    expect((detail.body as { data: { id: string } }).data.id).toBe(transferId);
    await request(server)
      .get(path)
      .set('Authorization', `Bearer ${tokens.get('CUSTOMER')}`)
      .expect(403);
    await request(server)
      .get(path)
      .set('Authorization', `Bearer ${tokens.get('WAREHOUSE_STAFF')}`)
      .expect(403);
    await request(server)
      .get(`/api/v1/warehouses/${randomUUID()}/transfers/${transferId}`)
      .set('Authorization', admin)
      .expect(404);
  });

  it('observes a real warehouse command resetting the stage, without mutating history on dashboard reads', async () => {
    const started = new Date(Date.now() - 3600000);
    const row = await shipment('live-command', 'AT_ORIGIN_WAREHOUSE', [], {
      currentWarehouseId: warehouseId,
      destinationWarehouseId: warehouseId,
      createdAt: new Date(started.getTime() - 1000),
    });
    await prisma.trackingEvent.create({
      data: {
        shipmentId: row.id,
        status: 'AT_ORIGIN_WAREHOUSE',
        type: 'WAREHOUSE_CHECK_IN',
        title: 'Check-in',
        createdAt: started,
      },
    });
    const query = Object.assign(new ControlTowerQueryDto(), { search: row.trackingCode });
    const read = async () =>
      (
        await prisma.$queryRaw<ControlTowerSnapshot[]>(
          controlTowerQuery(query, controlTowerPolicy(app.get(ConfigService))),
        )
      )[0];
    expect((await read()).items[0]).toMatchObject({
      stage: 'ORIGIN_DWELL',
      timestampQuality: 'VALID',
    });
    await request(server)
      .post(`/api/v1/warehouses/${warehouseId}/shipments/${row.id}/ready-for-delivery`)
      .set('Authorization', `Bearer ${tokens.get('ADMIN')}`)
      .expect(201);
    const count = await prisma.trackingEvent.count({ where: { shipmentId: row.id } });
    const fresh = await read();
    expect(fresh.items[0]).toMatchObject({
      stage: 'DESTINATION_DWELL',
      timestampQuality: 'VALID',
      slaState: 'ON_TIME',
    });
    expect(fresh.items[0].agingSeconds).toBeLessThan(10);
    expect(new Date(fresh.items[0].stageStartedAt!).getTime()).toBeGreaterThan(started.getTime());
    expect(await prisma.trackingEvent.count({ where: { shipmentId: row.id } })).toBe(count);
  });
});
