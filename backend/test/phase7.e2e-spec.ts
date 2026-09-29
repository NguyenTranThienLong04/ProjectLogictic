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
  const otherDriverEmail = `other-driver-p7-${runId}@example.com`;
  const otherCustomerEmail = `other-customer-p7-${runId}@example.com`;
  const emails = [driverEmail, adminEmail, customerEmail, otherDriverEmail, otherCustomerEmail];
  const shipmentIds: string[] = [];
  let driverToken = '';
  let adminToken = '';
  let customerToken = '';
  let driverProfileId = '';
  let adminId = '';
  let customerId = '';
  let otherDriverToken = '';
  let otherCustomerToken = '';
  const post = (path: string, token: string, body: object = {}) =>
    request(server).post(`/api/v1/cod/${path}`).set('Authorization', `Bearer ${token}`).send(body);

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
    customerToken = await login(customerEmail);
    const otherDriver = await prisma.user.create({
      data: {
        email: otherDriverEmail,
        fullName: 'Other Driver',
        passwordHash,
        role: UserRole.DRIVER,
      },
    });
    await prisma.driverProfile.create({
      data: {
        userId: otherDriver.id,
        employeeCode: `OTHER-${runId.slice(0, 12)}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: 'TEST',
      },
    });
    await prisma.user.create({
      data: {
        email: otherCustomerEmail,
        fullName: 'Other Customer',
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    });
    otherDriverToken = await login(otherDriverEmail);
    otherCustomerToken = await login(otherCustomerEmail);
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
    await prisma.cODPayout.deleteMany({
      where: { codTransaction: { shipmentId: { in: shipmentIds } } },
    });
    await prisma.cODRemittance.deleteMany({
      where: { codTransaction: { shipmentId: { in: shipmentIds } } },
    });
    await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.customerAddress.deleteMany({ where: { customerId: { in: userIds } } });
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
    const deliveryAudits = await prisma.auditLog.findMany({
      where: { action: 'DELIVERY_COMPLETE', entityType: 'Shipment', entityId: shipment.id },
    });
    expect(deliveryAudits).toHaveLength(1);
    expect(deliveryAudits[0]?.metadata).toMatchObject({
      attemptId: deliveryAttempt.id,
      assignmentId: assignment.id,
    });
    const cod = await prisma.cODTransaction.findUniqueOrThrow({
      where: { shipmentId: shipment.id },
    });
    expect(cod).toMatchObject({
      status: 'COLLECTED',
      expectedAmount: 275_000,
      collectedAmount: 275_000,
    });
    const readOverview = async () =>
      bodyFrom<{
        overview: {
          codCollected: number;
          codUnsettled: number;
          codAwaitingPayout: number;
          codPaidOut: number;
        };
      }>(
        await request(server)
          .get('/api/v1/dashboards/customer')
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(200),
      ).data.overview;
    const readDetail = async () =>
      bodyFrom<{ codStatus: string }>(
        await request(server)
          .get(`/api/v1/shipments/${shipment.id}`)
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(200),
      ).data;
    expect((await readOverview()).codUnsettled).toBe(275_000);
    expect((await readDetail()).codStatus).toBe('COLLECTED');
    const mine = bodyFrom<{ items: Array<{ id: string }> }>(
      await request(server)
        .get('/api/v1/cod/mine')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200),
    ).data;
    expect(mine.items.map((item) => item.id)).toContain(cod.id);
    await request(server)
      .get('/api/v1/cod/mine')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/cod/${cod.id}/settle`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
    const remitBody = {
      amount: 275_000,
      clientRequestId: randomUUID(),
      note: 'Internal handover note',
    };
    await post(`shipments/${shipment.id}/remit`, otherDriverToken, remitBody).expect(404);
    await post(`shipments/${shipment.id}/remit`, driverToken, {
      ...remitBody,
      amount: 274_000,
    }).expect(409);
    await post(`${cod.id}/payout`, adminToken, {
      amount: 275_000,
      method: 'BANK_TRANSFER',
      reference: 'BANK-001',
    }).expect(409);
    const handover = bodyFrom<{ id: string; status: string }>(
      await post(`shipments/${shipment.id}/remit`, driverToken, remitBody).expect(200),
    ).data;
    expect(handover.status).toBe('PENDING');
    expect((await readDetail()).codStatus).toBe('COLLECTED');
    expect((await readOverview()).codAwaitingPayout).toBe(0);
    await post(`remittances/${handover.id}/confirm`, driverToken, { expectedVersion: 0 }).expect(
      403,
    );
    await post(`${cod.id}/settle`, adminToken).expect(409);
    await post(`shipments/${shipment.id}/remit`, driverToken, {
      ...remitBody,
      clientRequestId: randomUUID(),
    }).expect(409);
    expect(
      bodyFrom<{ id: string }>(
        await post(`shipments/${shipment.id}/remit`, driverToken, remitBody).expect(200),
      ).data.id,
    ).toBe(handover.id);
    const confirms = await Promise.all(
      [0, 1].map(() =>
        post(`remittances/${handover.id}/confirm`, adminToken, { expectedVersion: 0 }),
      ),
    );
    expect(confirms.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await prisma.auditLog.count({
        where: { entityId: handover.id, action: 'COD_HANDOVER_CONFIRMED' },
      }),
    ).toBe(1);
    expect((await readOverview()).codUnsettled).toBe(275_000);
    expect((await readDetail()).codStatus).toBe('REMITTED');
    await request(server)
      .post(`/api/v1/cod/${cod.id}/settle`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((await readOverview()).codUnsettled).toBe(0);
    expect((await readDetail()).codStatus).toBe('SETTLED');
    expect(await readOverview()).toMatchObject({
      codCollected: 275_000,
      codUnsettled: 0,
      codAwaitingPayout: 275_000,
      codPaidOut: 0,
    });
    const payoutBody = {
      amount: 275_000,
      method: 'BANK_TRANSFER',
      reference: 'BANK-001',
      note: 'Internal payout note',
    };
    await post(`${cod.id}/payout`, adminToken, { ...payoutBody, amount: 274_999 }).expect(409);
    await post(`${cod.id}/payout`, adminToken, { ...payoutBody, reference: ' ' }).expect(409);
    const created = await Promise.all(
      [0, 1].map(() => post(`${cod.id}/payout`, adminToken, payoutBody)),
    );
    expect(created.map((r) => r.status)).toEqual([200, 200]);
    const payout = bodyFrom<{ id: string }>(created[0]).data;
    expect(bodyFrom<{ id: string }>(created[1]).data.id).toBe(payout.id);
    await post(`${cod.id}/payout`, adminToken, { ...payoutBody, reference: 'different' }).expect(
      409,
    );
    await post(`payouts/${payout.id}/confirm`, customerToken, { expectedVersion: 0 }).expect(409);
    await post(`payouts/${payout.id}/send`, driverToken, {
      expectedVersion: 0,
      reference: 'BANK-001',
    }).expect(403);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 1,
      reference: 'BANK-001',
    }).expect(409);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'BANK-001',
    }).expect(200);
    await post(`payouts/${payout.id}/confirm`, adminToken, { expectedVersion: 1 }).expect(403);
    await post(`payouts/${payout.id}/confirm`, otherCustomerToken, { expectedVersion: 1 }).expect(
      404,
    );
    await request(server)
      .get(`/api/v1/cod/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .expect(404);
    const safeRead = await request(server)
      .get(`/api/v1/cod/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<{ payout: { status: string } }>(safeRead).data.payout.status).toBe('SENT');
    expect(JSON.stringify(safeRead.body)).not.toMatch(/Internal|AdminId|DriverId|customerId/);
    const acknowledgments = await Promise.all(
      [0, 1].map(() => post(`payouts/${payout.id}/confirm`, customerToken, { expectedVersion: 1 })),
    );
    expect(acknowledgments.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await prisma.auditLog.count({
        where: { entityId: payout.id, action: 'COD_PAYOUT_RECEIVED' },
      }),
    ).toBe(1);
    expect(await prisma.cODPayout.count({ where: { codTransactionId: cod.id } })).toBe(1);
    expect(await readOverview()).toMatchObject({
      codCollected: 275_000,
      codUnsettled: 0,
      codAwaitingPayout: 0,
      codPaidOut: 275_000,
    });
    await post(`${cod.id}/payout`, adminToken, payoutBody).expect(200);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'BANK-001',
    }).expect(200);
    await post(`shipments/${shipment.id}/remit`, driverToken, remitBody).expect(200);
    const reload = await request(server)
      .get(`/api/v1/cod/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<{ payout: { status: string } }>(reload).data.payout.status).toBe('PAID_OUT');
    expect(
      await prisma.shippingFeeTransaction.findUnique({ where: { shipmentId: shipment.id } }),
    ).toMatchObject({ status: 'COLLECTED', expectedAmount: 30_000, collectedAmount: 30_000 });
  });

  it('persists confirmed six-decimal device coordinates without replacing administrative fields', async () => {
    const address = {
      label: 'GPS',
      contactName: 'GPS Customer',
      phone: '0901234567',
      streetAddress: '123 Nguyễn Trãi',
      city: 'Hồ Chí Minh',
      ward: 'Bến Thành',
      district: '',
      latitude: 10.769508,
      longitude: 106.690795,
    };
    const created = bodyFrom<{ id: string }>(
      await request(server)
        .post('/api/v1/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(address)
        .expect(201),
    ).data;
    const list = bodyFrom<Array<{ id: string }>>(
      await request(server)
        .get('/api/v1/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200),
    ).data;
    expect(list.find((item) => item.id === created.id)).toMatchObject(address);
    const stored = await prisma.customerAddress.findUniqueOrThrow({ where: { id: created.id } });
    expect({
      ...stored,
      latitude: Number(stored.latitude),
      longitude: Number(stored.longitude),
    }).toMatchObject(address);
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

    const requestId = randomUUID();
    const responses = await Promise.all([
      request(server)
        .post(`/api/v1/cod/shipments/${shipment.id}/remit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ amount: 150_000, clientRequestId: requestId }),
      request(server)
        .post(`/api/v1/cod/shipments/${shipment.id}/remit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ amount: 150_000, clientRequestId: requestId }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const remittanceId = bodyFrom<{ id: string }>(responses[0]).data.id;
    expect(await prisma.cODTransaction.findUnique({ where: { id: cod.id } })).toMatchObject({
      status: 'COLLECTED',
      remittedAmount: null,
    });
    await post(`remittances/${remittanceId}/confirm`, adminToken, { expectedVersion: 0 }).expect(
      200,
    );
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

  it('preserves rejected handovers, validates command input and keeps disputed payouts unpaid', async () => {
    const shipment = await createShipment('REJECT', 500_000, ShipmentStatus.DELIVERED);
    const feeBefore = await prisma.shippingFeeTransaction.findUnique({
      where: { shipmentId: shipment.id },
    });
    const cod = await prisma.cODTransaction.create({
      data: {
        shipmentId: shipment.id,
        expectedAmount: 500_000,
        collectedAmount: 500_000,
        collectedByDriverId: driverProfileId,
        collectedAt: new Date(),
        status: 'COLLECTED',
      },
    });
    const body = { amount: 500_000, clientRequestId: randomUUID() };
    for (const amount of [0, -1, 0.5, 2147483648])
      await post(`shipments/${shipment.id}/remit`, driverToken, { ...body, amount }).expect(400);
    await post(`shipments/${shipment.id}/remit`, driverToken, {
      ...body,
      status: 'REMITTED',
    }).expect(400);
    const pending = bodyFrom<{ id: string }>(
      await post(`shipments/${shipment.id}/remit`, driverToken, body).expect(200),
    ).data;
    await post(`remittances/${pending.id}/reject`, adminToken, {
      expectedVersion: 0,
      reason: ' ',
    }).expect(400);
    await post(`remittances/${pending.id}/confirm`, adminToken, { expectedVersion: 99 }).expect(
      409,
    );
    for (let i = 0; i < 2; i++)
      await post(`remittances/${pending.id}/reject`, adminToken, {
        expectedVersion: 0,
        reason: 'Chưa nhận tiền thực tế',
      }).expect(200);
    expect(await prisma.cODTransaction.findUnique({ where: { id: cod.id } })).toMatchObject({
      status: 'COLLECTED',
      remittedAt: null,
    });
    await post(`remittances/${pending.id}/confirm`, adminToken, { expectedVersion: 1 }).expect(409);
    expect(
      bodyFrom<{ status: string }>(
        await post(`shipments/${shipment.id}/remit`, driverToken, body).expect(200),
      ).data.status,
    ).toBe('REJECTED');
    const retry = bodyFrom<{ id: string }>(
      await post(`shipments/${shipment.id}/remit`, driverToken, {
        ...body,
        clientRequestId: randomUUID(),
      }).expect(200),
    ).data;
    expect(retry.id).not.toBe(pending.id);
    // The partial index protects the invariant even if another writer bypasses the service.
    await expect(
      prisma.cODRemittance.create({
        data: {
          codTransactionId: cod.id,
          submittedByDriverId: driverProfileId,
          amount: 500_000,
          clientRequestId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await post(`remittances/${retry.id}/confirm`, adminToken, { expectedVersion: 0 }).expect(200);
    await post(`${cod.id}/settle`, adminToken).expect(200);
    const payout = bodyFrom<{ id: string }>(
      await post(`${cod.id}/payout`, adminToken, {
        amount: 500_000,
        method: 'CASH',
        reference: 'RECEIPT-002',
      }).expect(200),
    ).data;
    await expect(
      prisma.cODPayout.create({
        data: {
          codTransactionId: cod.id,
          customerId,
          amount: 500_000,
          method: 'CASH',
          reference: 'DUPLICATE',
          createdByAdminId: adminId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await post(`payouts/${payout.id}/dispute`, customerToken, {
      expectedVersion: 0,
      reason: 'Not yet',
    }).expect(409);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'WRONG',
    }).expect(409);
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'RECEIPT-002',
    }).expect(200);
    await post(`payouts/${payout.id}/dispute`, otherCustomerToken, {
      expectedVersion: 1,
      reason: 'Not mine',
    }).expect(404);
    for (let i = 0; i < 2; i++)
      await post(`payouts/${payout.id}/dispute`, customerToken, {
        expectedVersion: 1,
        reason: 'Chưa nhận tiền',
      }).expect(200);
    await post(`payouts/${payout.id}/confirm`, customerToken, { expectedVersion: 2 }).expect(409);
    expect(await prisma.cODPayout.findUnique({ where: { id: payout.id } })).toMatchObject({
      status: 'DISPUTED',
      customerConfirmedAt: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { entityId: pending.id, action: 'COD_HANDOVER_REJECTED' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: payout.id, action: 'COD_PAYOUT_DISPUTED' },
      }),
    ).toBe(1);
    expect(await prisma.cODRemittance.count({ where: { codTransactionId: cod.id } })).toBe(2);
    const overview = bodyFrom<{ overview: { codPaidOut: number; codAwaitingPayout: number } }>(
      await request(server)
        .get('/api/v1/dashboards/customer')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200),
    ).data.overview;
    expect(overview.codPaidOut).toBe(275_000);
    expect(overview.codAwaitingPayout).toBe(725_000); // prior legacy settlement + this disputed payout
    expect(
      await prisma.shippingFeeTransaction.findUnique({ where: { shipmentId: shipment.id } }),
    ).toEqual(feeBefore);
  });

  it('commits only one outcome when confirmation races against rejection or a customer dispute', async () => {
    const shipment = await createShipment('RACE', 125_000, ShipmentStatus.DELIVERED);
    const cod = await prisma.cODTransaction.create({
      data: {
        shipmentId: shipment.id,
        expectedAmount: 125_000,
        collectedAmount: 125_000,
        collectedByDriverId: driverProfileId,
        collectedAt: new Date(),
        status: 'COLLECTED',
      },
    });
    const submit = async () =>
      bodyFrom<{ id: string }>(
        await post(`shipments/${shipment.id}/remit`, driverToken, {
          amount: 125_000,
          clientRequestId: randomUUID(),
        }).expect(200),
      ).data;
    const handover = await submit();
    const reviewed = await Promise.all([
      post(`remittances/${handover.id}/confirm`, adminToken, { expectedVersion: 0 }),
      post(`remittances/${handover.id}/reject`, adminToken, {
        expectedVersion: 0,
        reason: 'Kiểm tra lại',
      }),
    ]);
    expect(reviewed.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: handover.id,
          action: { in: ['COD_HANDOVER_CONFIRMED', 'COD_HANDOVER_REJECTED'] },
        },
      }),
    ).toBe(1);
    const current = await prisma.cODTransaction.findUniqueOrThrow({ where: { id: cod.id } });
    if (current.status === 'COLLECTED') {
      const next = await submit();
      await post(`remittances/${next.id}/confirm`, adminToken, { expectedVersion: 0 }).expect(200);
    }
    await post(`${cod.id}/settle`, adminToken).expect(200);
    const payout = bodyFrom<{ id: string }>(
      await post(`${cod.id}/payout`, adminToken, {
        amount: 125_000,
        method: 'BANK_TRANSFER',
        reference: 'RACE-REF',
      }).expect(200),
    ).data;
    await post(`payouts/${payout.id}/send`, adminToken, {
      expectedVersion: 0,
      reference: 'RACE-REF',
    }).expect(200);
    const received = await Promise.all([
      post(`payouts/${payout.id}/confirm`, customerToken, { expectedVersion: 1 }),
      post(`payouts/${payout.id}/dispute`, customerToken, {
        expectedVersion: 1,
        reason: 'Chưa nhận',
      }),
    ]);
    expect(received.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: payout.id,
          action: { in: ['COD_PAYOUT_RECEIVED', 'COD_PAYOUT_DISPUTED'] },
        },
      }),
    ).toBe(1);
    const final = await prisma.cODPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(final.version).toBe(2);
    expect(Boolean(final.customerConfirmedAt)).not.toBe(Boolean(final.disputedAt));
    expect(await prisma.cODTransaction.findUnique({ where: { id: cod.id } })).toMatchObject({
      status: 'SETTLED',
    });
  });
});
