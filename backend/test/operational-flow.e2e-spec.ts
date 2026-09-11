import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  CODTransactionStatus,
  DriverAssignmentStatus,
  DriverStatus,
  ShipmentStatus,
  ShippingFeePayer,
  UserRole,
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(300_000);

interface ApiEnvelope<T> {
  data: T;
}

interface CandidateResponse {
  distanceMethod: 'HAVERSINE_FALLBACK';
  distanceNotice: string;
  candidates: Array<{
    id: string;
    operatingWarehouse: { id: string };
    estimatedDistanceKm: number;
  }>;
  exclusions: {
    outsideOperatingArea: number;
    noCurrentLocation: number;
  };
}

interface TaskLocation {
  kind: 'PICKUP' | 'DESTINATION_WAREHOUSE' | 'RECEIVER';
  latitude: number | null;
  longitude: number | null;
}

interface ShipmentPayload {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  totalFee: number;
  codAmount: number;
  shippingFeePayer: ShippingFeePayer;
  timeline: Array<{ status: ShipmentStatus; type: string }>;
}

interface OperationalShipmentPayload {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  shippingFeePayer: ShippingFeePayer;
  originWarehouse: { id: string } | null;
  destinationWarehouse: { id: string } | null;
  currentWarehouse: { id: string } | null;
  pickupAssignment: { id: string; status: DriverAssignmentStatus } | null;
  deliveryAssignment: { id: string; status: DriverAssignmentStatus } | null;
}

interface DriverLocationPayload {
  driverId: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Full operational logistics flow after Realism Phase A-E (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  const sockets: Socket[] = [];
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'Password@123456';
  const actors = {
    admin: `admin-operational-${runId}@example.com`,
    dispatcher: `dispatcher-operational-${runId}@example.com`,
    customer: `customer-operational-${runId}@example.com`,
    originStaff: `origin-staff-operational-${runId}@example.com`,
    destinationStaff: `destination-staff-operational-${runId}@example.com`,
    pickupNear: `pickup-near-operational-${runId}@example.com`,
    pickupFar: `pickup-far-operational-${runId}@example.com`,
    pickupWrongArea: `pickup-wrong-operational-${runId}@example.com`,
    pickupNoGps: `pickup-no-gps-operational-${runId}@example.com`,
    pickupStaleGps: `pickup-stale-operational-${runId}@example.com`,
    deliveryNear: `delivery-near-operational-${runId}@example.com`,
    deliveryFar: `delivery-far-operational-${runId}@example.com`,
    deliveryNoGps: `delivery-no-gps-operational-${runId}@example.com`,
    deliveryStaleGps: `delivery-stale-operational-${runId}@example.com`,
  } as const;
  const tokens: Partial<Record<keyof typeof actors, string>> = {};
  const userIds: string[] = [];
  const driverIds: string[] = [];
  const warehouseIds: string[] = [];

  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let pickupNearId = '';
  let pickupFarId = '';
  let pickupWrongAreaId = '';
  let pickupNoGpsId = '';
  let pickupStaleGpsId = '';
  let deliveryNearId = '';
  let deliveryFarId = '';
  let deliveryNoGpsId = '';
  let deliveryStaleGpsId = '';
  let pickupAddressId = '';
  let shipmentId = '';
  let trackingCode = '';
  let shipmentClientRequestId = '';
  let pickupAssignmentId = '';
  let transferId = '';
  let deliveryAssignmentId = '';
  let deliveryAttemptId = '';
  let originalTotalFee = 0;
  let customerSocket: Socket;

  const token = (actor: keyof typeof actors): string => {
    const value = tokens[actor];
    if (!value) throw new Error(`Missing access token for ${actor}`);
    return value;
  };

  const driverId = (emailToProfile: Map<string, string>, actor: keyof typeof actors): string => {
    const value = emailToProfile.get(actors[actor]);
    if (!value) throw new Error(`Missing driver profile for ${actor}`);
    return value;
  };

  const setRedisLocation = async (
    id: string,
    latitude: number,
    longitude: number,
    updatedAt = new Date().toISOString(),
  ) =>
    redis
      .getClient()
      .set(
        `driver:location:${id}`,
        JSON.stringify({ driverId: id, latitude, longitude, updatedAt }),
        'EX',
        60,
      );

  const updateOwnLocation = async (
    actor: Extract<keyof typeof actors, 'pickupNear' | 'deliveryNear'>,
    latitude: number,
    longitude: number,
  ): Promise<DriverLocationPayload> => {
    const response = await request(server)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${token(actor)}`)
      .send({ latitude, longitude })
      .expect(200);
    return bodyFrom<DriverLocationPayload>(response).data;
  };

  const historyCounts = () =>
    Promise.all([
      prisma.trackingEvent.count({ where: { shipmentId } }),
      prisma.auditLog.count({ where: { actorId: { in: userIds } } }),
      prisma.shipmentProof.count({ where: { shipmentId } }),
      prisma.warehouseTransfer.count({ where: { shipmentId } }),
      prisma.cODTransaction.count({ where: { shipmentId } }),
    ]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const cookieParser = (await import('cookie-parser')).default;
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    if (!redis.isAvailable()) {
      throw new Error('Full operational E2E requires the configured development Redis instance');
    }

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const roleFor = (name: keyof typeof actors): UserRole => {
      if (name === 'admin') return UserRole.ADMIN;
      if (name === 'dispatcher') return UserRole.DISPATCHER;
      if (name === 'customer') return UserRole.CUSTOMER;
      if (name === 'originStaff' || name === 'destinationStaff') {
        return UserRole.WAREHOUSE_STAFF;
      }
      return UserRole.DRIVER;
    };
    await prisma.user.createMany({
      data: Object.entries(actors).map(([name, email]) => ({
        email,
        fullName: `Operational ${name}`,
        passwordHash,
        role: roleFor(name as keyof typeof actors),
      })),
    });
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(actors) } },
      select: { id: true, email: true },
    });
    userIds.push(...users.map(({ id }) => id));
    const userByEmail = new Map(users.map((user) => [user.email, user.id]));
    const userId = (actor: keyof typeof actors): string => {
      const value = userByEmail.get(actors[actor]);
      if (!value) throw new Error(`Missing user for ${actor}`);
      return value;
    };

    const originCode = `OPS-ORI-${suffix}`;
    const destinationCode = `OPS-DST-${suffix}`;
    await prisma.warehouse.createMany({
      data: [
        {
          code: originCode,
          name: 'Operational Đà Nẵng Origin Hub',
          address: '1 Bạch Đằng',
          ward: 'Hải Châu 1',
          district: 'Hải Châu',
          city: 'Đà Nẵng',
          latitude: 16.0678,
          longitude: 108.2208,
        },
        {
          code: destinationCode,
          name: 'Operational Hồ Chí Minh Destination Hub',
          address: '1 Nguyễn Huệ',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
          latitude: 10.7769,
          longitude: 106.7009,
        },
      ],
    });
    const warehouses = await prisma.warehouse.findMany({
      where: { code: { in: [originCode, destinationCode] } },
      select: { id: true, code: true },
    });
    originWarehouseId = warehouses.find(({ code }) => code === originCode)?.id ?? '';
    destinationWarehouseId = warehouses.find(({ code }) => code === destinationCode)?.id ?? '';
    if (!originWarehouseId || !destinationWarehouseId) {
      throw new Error('Operational warehouses were not created');
    }
    warehouseIds.push(originWarehouseId, destinationWarehouseId);

    await prisma.warehouseStaffProfile.createMany({
      data: [
        {
          userId: userId('originStaff'),
          warehouseId: originWarehouseId,
          staffCode: `OPS-ORI-STF-${suffix}`,
        },
        {
          userId: userId('destinationStaff'),
          warehouseId: destinationWarehouseId,
          staffCode: `OPS-DST-STF-${suffix}`,
        },
      ],
    });

    const driverActors = [
      'pickupNear',
      'pickupFar',
      'pickupWrongArea',
      'pickupNoGps',
      'pickupStaleGps',
      'deliveryNear',
      'deliveryFar',
      'deliveryNoGps',
      'deliveryStaleGps',
    ] as const;
    await prisma.driverProfile.createMany({
      data: driverActors.map((name, index) => ({
        userId: userId(name),
        operatingWarehouseId:
          name.startsWith('delivery') || name === 'pickupWrongArea'
            ? destinationWarehouseId
            : originWarehouseId,
        employeeCode: `OPS-${index + 1}-${suffix}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `OPS-${suffix.slice(0, 4)}-${index + 1}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      })),
    });
    const profiles = await prisma.driverProfile.findMany({
      where: { userId: { in: driverActors.map((name) => userId(name)) } },
      include: { user: { select: { email: true } } },
    });
    driverIds.push(...profiles.map(({ id }) => id));
    const profileByEmail = new Map(profiles.map((profile) => [profile.user.email, profile.id]));
    pickupNearId = driverId(profileByEmail, 'pickupNear');
    pickupFarId = driverId(profileByEmail, 'pickupFar');
    pickupWrongAreaId = driverId(profileByEmail, 'pickupWrongArea');
    pickupNoGpsId = driverId(profileByEmail, 'pickupNoGps');
    pickupStaleGpsId = driverId(profileByEmail, 'pickupStaleGps');
    deliveryNearId = driverId(profileByEmail, 'deliveryNear');
    deliveryFarId = driverId(profileByEmail, 'deliveryFar');
    deliveryNoGpsId = driverId(profileByEmail, 'deliveryNoGps');
    deliveryStaleGpsId = driverId(profileByEmail, 'deliveryStaleGps');

    const loginActors = [
      'admin',
      'dispatcher',
      'customer',
      'originStaff',
      'destinationStaff',
      'pickupNear',
      'deliveryNear',
    ] as const;
    for (const actor of loginActors) {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: actors[actor], password })
        .expect(200);
      tokens[actor] = bodyFrom<{ accessToken: string }>(response).data.accessToken;
    }
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (redis?.isAvailable()) {
      const keys = driverIds.map((id) => `driver:location:${id}`);
      if (trackingCode) keys.push(`tracking:${trackingCode}`);
      if (shipmentId) keys.push(`shipment:${shipmentId}:summary`);
      if (keys.length > 0) await redis.getClient().del(keys);
    }
    if (userIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    }
    if (shipmentId) {
      await prisma.shipmentProof.deleteMany({ where: { shipmentId } });
      await prisma.deliveryAttempt.deleteMany({ where: { shipmentId } });
      await prisma.driverAssignment.deleteMany({ where: { shipmentId } });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId } });
      await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId } });
      await prisma.warehouseTransfer.deleteMany({ where: { shipmentId } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId } });
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    }
    if (userIds.length > 0) {
      await prisma.customerAddress.deleteMany({ where: { customerId: { in: userIds } } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (warehouseIds.length > 0) {
      await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    }
    await app.close();
  });

  it('creates, confirms, ranks pickup candidates, renders the pickup task, and picks up once', async () => {
    const addressResponse = await request(server)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token('customer')}`)
      .send({
        label: 'Operational origin',
        contactName: 'Operational sender',
        phone: '0901234567',
        streetAddress: '20 Bạch Đằng',
        ward: 'Hải Châu 1',
        district: 'Hải Châu',
        city: 'Đà Nẵng',
        latitude: 16.0685,
        longitude: 108.2215,
        isDefault: true,
      })
      .expect(201);
    pickupAddressId = bodyFrom<{ id: string }>(addressResponse).data.id;

    shipmentClientRequestId = randomUUID();
    const createBody = {
      clientRequestId: shipmentClientRequestId,
      pickupAddressId,
      deliveryAddress: {
        contactName: 'Operational receiver',
        phone: '0987654321',
        streetAddress: '25 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        latitude: 10.7775,
        longitude: 106.7015,
      },
      package: {
        description: 'Operational inter-provincial parcel',
        packageType: 'PARCEL',
        weightGrams: 2_100,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 15,
      },
      codAmount: 450_000,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
    };
    const createResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${token('customer')}`)
      .send(createBody)
      .expect(201);
    const created = bodyFrom<ShipmentPayload>(createResponse).data;
    shipmentId = created.id;
    trackingCode = created.trackingCode;
    originalTotalFee = created.totalFee;
    process.stdout.write(`[operational-e2e] trackingCode=${trackingCode}\n`);
    expect(created).toMatchObject({
      status: ShipmentStatus.PENDING,
      codAmount: 450_000,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
    });
    expect(trackingCode).toMatch(/^SHP-/);

    customerSocket = await connectCustomerSocket();
    sockets.push(customerSocket);
    await expect(subscribe(customerSocket, shipmentId)).resolves.toEqual({ subscribed: true });
    await request(server)
      .get(`/api/v1/shipments/${shipmentId}/location`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(404);

    await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/confirm`)
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .expect(200);
    await expect(
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ).resolves.toMatchObject({ status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT });

    await Promise.all([
      updateOwnLocation('pickupNear', 16.0686, 108.2216),
      setRedisLocation(pickupFarId, 16.12, 108.28),
      setRedisLocation(pickupWrongAreaId, 16.0685, 108.2215),
      setRedisLocation(
        pickupStaleGpsId,
        16.0685,
        108.2215,
        new Date(Date.now() - 20_001).toISOString(),
      ),
    ]);
    await redis.getClient().del(`driver:location:${pickupNoGpsId}`);

    const candidatesResponse = await request(server)
      .get(`/api/v1/dispatcher/shipments/${shipmentId}/pickup-candidates`)
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .expect(200);
    const candidates = bodyFrom<CandidateResponse>(candidatesResponse).data;
    const candidateIds = candidates.candidates.map(({ id }) => id);
    expect(candidates.distanceMethod).toBe('HAVERSINE_FALLBACK');
    expect(candidates.distanceNotice).toContain('ước tính');
    expect(candidateIds.indexOf(pickupNearId)).toBeGreaterThanOrEqual(0);
    expect(candidateIds.indexOf(pickupNearId)).toBeLessThan(candidateIds.indexOf(pickupFarId));
    expect(candidateIds).not.toEqual(
      expect.arrayContaining([pickupWrongAreaId, pickupNoGpsId, pickupStaleGpsId]),
    );
    expect(candidates.exclusions.outsideOperatingArea).toBeGreaterThanOrEqual(1);
    expect(candidates.exclusions.noCurrentLocation).toBeGreaterThanOrEqual(2);

    for (const ineligibleId of [pickupWrongAreaId, pickupNoGpsId, pickupStaleGpsId]) {
      await request(server)
        .post(`/api/v1/dispatcher/shipments/${shipmentId}/pickup-assignments`)
        .set('Authorization', `Bearer ${token('dispatcher')}`)
        .send({ driverId: ineligibleId, clientRequestId: randomUUID() })
        .expect(409);
    }

    const freshPickupLocation = await updateOwnLocation('pickupNear', 16.0686, 108.2216);
    const assignResponse = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/pickup-assignments`)
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ driverId: pickupNearId, clientRequestId: randomUUID() })
      .expect(201);
    pickupAssignmentId = bodyFrom<{ id: string }>(assignResponse).data.id;

    const taskResponse = await request(server)
      .get(`/api/v1/driver/assignments/${pickupAssignmentId}`)
      .set('Authorization', `Bearer ${token('pickupNear')}`)
      .expect(200);
    const pickupTask = bodyFrom<{ taskLocation: TaskLocation }>(taskResponse).data.taskLocation;
    expect(pickupTask).toMatchObject({
      kind: 'PICKUP',
      latitude: 16.0685,
      longitude: 108.2215,
    });
    const driverLocationResponse = await request(server)
      .get('/api/v1/driver/location')
      .set('Authorization', `Bearer ${token('pickupNear')}`)
      .expect(200);
    expect(bodyFrom<DriverLocationPayload>(driverLocationResponse).data).toMatchObject({
      driverId: pickupNearId,
      latitude: freshPickupLocation.latitude,
      longitude: freshPickupLocation.longitude,
    });

    await expectNoLocationEvent(customerSocket, () =>
      updateOwnLocation('pickupNear', 16.0687, 108.2217),
    );
    await request(server)
      .get(`/api/v1/shipments/${shipmentId}/location`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(404);

    const acceptedResponse = await request(server)
      .post(`/api/v1/driver/assignments/${pickupAssignmentId}/accept`)
      .set('Authorization', `Bearer ${token('pickupNear')}`)
      .expect(200);
    expect(
      bodyFrom<{ status: DriverAssignmentStatus; shipmentStatus: ShipmentStatus }>(acceptedResponse)
        .data,
    ).toMatchObject({
      status: DriverAssignmentStatus.ACCEPTED,
      shipmentStatus: ShipmentStatus.PICKUP_IN_PROGRESS,
    });

    const pickupResponse = await request(server)
      .post(`/api/v1/driver/assignments/${pickupAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${token('pickupNear')}`)
      .send({ note: 'Pickup proof: sealed parcel received from sender' })
      .expect(200);
    expect(
      bodyFrom<{ status: DriverAssignmentStatus; shipmentStatus: ShipmentStatus }>(pickupResponse)
        .data,
    ).toMatchObject({
      status: DriverAssignmentStatus.COMPLETED,
      shipmentStatus: ShipmentStatus.PICKED_UP,
    });
    const countsAfterPickup = await historyCounts();
    await request(server)
      .post(`/api/v1/driver/assignments/${pickupAssignmentId}/pickup`)
      .set('Authorization', `Bearer ${token('pickupNear')}`)
      .send({ note: 'Duplicate pickup retry must return the committed proof' })
      .expect(200);
    expect(await historyCounts()).toEqual(countsAfterPickup);
    await expect(
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ).resolves.toMatchObject({
      status: ShipmentStatus.PICKED_UP,
      originWarehouseId,
      currentWarehouseId: null,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
    });
  });

  it('checks in only at origin, transfers once, receives only at destination, and becomes ready', async () => {
    const verification = {
      trackingCode,
      packageVerified: true,
      actualWeightGrams: 2_120,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    };
    await request(server)
      .get(`/api/v1/warehouses/${destinationWarehouseId}/check-in/lookup`)
      .query({ trackingCode })
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .send(verification)
      .expect(403);
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send({ ...verification, packageVerified: false })
      .expect(400);

    await request(server)
      .get(`/api/v1/warehouses/${originWarehouseId}/check-in/lookup`)
      .query({ trackingCode })
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .expect(200);
    const checkInResponse = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send({ ...verification, note: 'Package verified at origin' })
      .expect(200);
    expect(
      bodyFrom<{ idempotent: boolean; shipment: { status: ShipmentStatus } }>(checkInResponse).data,
    ).toMatchObject({
      idempotent: false,
      shipment: { status: ShipmentStatus.AT_ORIGIN_WAREHOUSE },
    });
    const countsAfterCheckIn = await historyCounts();
    const checkInRetry = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send(verification)
      .expect(200);
    expect(bodyFrom<{ idempotent: boolean }>(checkInRetry).data.idempotent).toBe(true);
    expect(await historyCounts()).toEqual(countsAfterCheckIn);

    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/shipments/${shipmentId}/route-destination`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send({ destinationWarehouseId })
      .expect(201);
    const transferClientRequestId = randomUUID();
    const transferBody = {
      shipmentId,
      toWarehouseId: destinationWarehouseId,
      clientRequestId: transferClientRequestId,
      note: 'Operational inter-provincial transfer',
    };
    const transferResponse = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send(transferBody)
      .expect(201);
    const transfer = bodyFrom<{ id: string; status: WarehouseTransferStatus }>(
      transferResponse,
    ).data;
    transferId = transfer.id;
    expect(transfer.status).toBe(WarehouseTransferStatus.PENDING);
    await expect(
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ).resolves.toMatchObject({
      status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
      currentWarehouseId: originWarehouseId,
      destinationWarehouseId,
    });
    const countsAfterTransferCreate = await historyCounts();
    const transferRetry = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send(transferBody)
      .expect(201);
    expect(bodyFrom<{ id: string }>(transferRetry).data.id).toBe(transferId);
    expect(await historyCounts()).toEqual(countsAfterTransferCreate);

    const dispatchResponse = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .expect(200);
    expect(bodyFrom<{ status: WarehouseTransferStatus }>(dispatchResponse).data.status).toBe(
      WarehouseTransferStatus.IN_TRANSIT,
    );
    await expect(
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ).resolves.toMatchObject({ status: ShipmentStatus.IN_TRANSIT, currentWarehouseId: null });
    const countsAfterDispatch = await historyCounts();
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transferId}/dispatch`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .expect(200);
    expect(await historyCounts()).toEqual(countsAfterDispatch);

    const inboundResponse = await request(server)
      .get(`/api/v1/warehouses/${destinationWarehouseId}/inbound-queue`)
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .expect(200);
    expect(
      bodyFrom<{ incomingTransfers: Array<{ id: string }> }>(inboundResponse).data
        .incomingTransfers,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: transferId })]));
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${token('originStaff')}`)
      .send({ note: 'Wrong destination receive attempt' })
      .expect(403);

    const receiveResponse = await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .send({ note: 'Package received intact', actualWeightGrams: 2_120 })
      .expect(200);
    expect(bodyFrom<{ status: WarehouseTransferStatus }>(receiveResponse).data.status).toBe(
      WarehouseTransferStatus.COMPLETED,
    );
    await expect(
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
    ).resolves.toMatchObject({
      status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
      currentWarehouseId: destinationWarehouseId,
    });
    const countsAfterReceive = await historyCounts();
    await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transferId}/receive`)
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .send({ note: 'Duplicate receive retry' })
      .expect(200);
    expect(await historyCounts()).toEqual(countsAfterReceive);

    const readyResponse = await request(server)
      .post(
        `/api/v1/warehouses/${destinationWarehouseId}/shipments/${shipmentId}/ready-for-delivery`,
      )
      .set('Authorization', `Bearer ${token('destinationStaff')}`)
      .expect(201);
    expect(
      bodyFrom<{ status: ShipmentStatus; currentWarehouseId: string }>(readyResponse).data,
    ).toMatchObject({
      status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
      currentWarehouseId: destinationWarehouseId,
    });
  });

  it('ranks delivery candidates, switches the task target, gates customer GPS, and delivers once', async () => {
    await Promise.all([
      updateOwnLocation('deliveryNear', 10.777, 106.701),
      setRedisLocation(deliveryFarId, 10.85, 106.78),
      setRedisLocation(pickupNearId, 10.777, 106.701),
      setRedisLocation(
        deliveryStaleGpsId,
        10.777,
        106.701,
        new Date(Date.now() - 20_001).toISOString(),
      ),
    ]);
    await redis.getClient().del(`driver:location:${deliveryNoGpsId}`);

    const candidatesResponse = await request(server)
      .get(`/api/v1/dispatcher/shipments/${shipmentId}/delivery-candidates`)
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .expect(200);
    const candidates = bodyFrom<CandidateResponse>(candidatesResponse).data;
    const candidateIds = candidates.candidates.map(({ id }) => id);
    expect(candidateIds.indexOf(deliveryNearId)).toBeGreaterThanOrEqual(0);
    expect(candidateIds.indexOf(deliveryNearId)).toBeLessThan(candidateIds.indexOf(deliveryFarId));
    expect(candidateIds).not.toEqual(
      expect.arrayContaining([pickupNearId, deliveryNoGpsId, deliveryStaleGpsId]),
    );
    expect(
      candidates.candidates.every(
        (candidate) => candidate.operatingWarehouse.id === destinationWarehouseId,
      ),
    ).toBe(true);

    for (const ineligibleId of [pickupNearId, deliveryNoGpsId, deliveryStaleGpsId]) {
      await request(server)
        .post(`/api/v1/dispatcher/shipments/${shipmentId}/delivery-assignments`)
        .set('Authorization', `Bearer ${token('dispatcher')}`)
        .send({ driverId: ineligibleId, clientRequestId: randomUUID() })
        .expect(409);
    }

    await updateOwnLocation('deliveryNear', 10.777, 106.701);
    const assignmentResponse = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/delivery-assignments`)
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ driverId: deliveryNearId, clientRequestId: randomUUID() })
      .expect(201);
    deliveryAssignmentId = bodyFrom<{ id: string }>(assignmentResponse).data.id;

    const beforeStartResponse = await request(server)
      .get(`/api/v1/driver/delivery-assignments/${deliveryAssignmentId}`)
      .set('Authorization', `Bearer ${token('deliveryNear')}`)
      .expect(200);
    const beforeStart = bodyFrom<{
      delivery: Record<string, unknown>;
      taskLocation: TaskLocation;
    }>(beforeStartResponse).data;
    expect(beforeStart.taskLocation).toMatchObject({
      kind: 'DESTINATION_WAREHOUSE',
      latitude: 10.7769,
      longitude: 106.7009,
    });
    expect(beforeStart.delivery).not.toHaveProperty('latitude');
    expect(beforeStart.delivery).not.toHaveProperty('longitude');
    await expectNoLocationEvent(customerSocket, () =>
      updateOwnLocation('deliveryNear', 10.7771, 106.7011),
    );
    await request(server)
      .get(`/api/v1/shipments/${shipmentId}/location`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(404);

    const startResponse = await request(server)
      .post(`/api/v1/driver/delivery-assignments/${deliveryAssignmentId}/start`)
      .set('Authorization', `Bearer ${token('deliveryNear')}`)
      .expect(200);
    const started = bodyFrom<{
      shipmentStatus: ShipmentStatus;
      taskLocation: TaskLocation;
      attempt: { id: string };
    }>(startResponse).data;
    deliveryAttemptId = started.attempt.id;
    expect(started.shipmentStatus).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
    expect(started.taskLocation).toMatchObject({
      kind: 'RECEIVER',
      latitude: 10.7775,
      longitude: 106.7015,
    });

    const locationEvent = waitForLocationEvent(customerSocket);
    const currentDeliveryLocation = await updateOwnLocation('deliveryNear', 10.7773, 106.7013);
    await expect(locationEvent).resolves.toMatchObject({
      driverId: deliveryNearId,
      latitude: currentDeliveryLocation.latitude,
      longitude: currentDeliveryLocation.longitude,
    });
    const customerLocationResponse = await request(server)
      .get(`/api/v1/shipments/${shipmentId}/location`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(200);
    expect(bodyFrom<DriverLocationPayload>(customerLocationResponse).data).toMatchObject({
      driverId: deliveryNearId,
      latitude: 10.7773,
      longitude: 106.7013,
    });

    const completeResponse = await request(server)
      .post(`/api/v1/driver/delivery-assignments/${deliveryAssignmentId}/complete`)
      .set('Authorization', `Bearer ${token('deliveryNear')}`)
      .send({
        receiverName: 'Operational receiver',
        note: 'POD signed and parcel intact',
        shippingFeeAmount: originalTotalFee,
      })
      .expect(200);
    expect(
      bodyFrom<{ status: DriverAssignmentStatus; shipmentStatus: ShipmentStatus }>(completeResponse)
        .data,
    ).toMatchObject({
      status: DriverAssignmentStatus.COMPLETED,
      shipmentStatus: ShipmentStatus.DELIVERED,
    });
    const countsAfterDelivery = await historyCounts();
    await request(server)
      .post(`/api/v1/driver/delivery-assignments/${deliveryAssignmentId}/complete`)
      .set('Authorization', `Bearer ${token('deliveryNear')}`)
      .send({
        receiverName: 'Operational receiver',
        note: 'Duplicate completion retry',
        shippingFeeAmount: originalTotalFee,
      })
      .expect(200);
    expect(await historyCounts()).toEqual(countsAfterDelivery);
    expect(await prisma.shipmentProof.count({ where: { shipmentId } })).toBe(2);
    expect(await prisma.deliveryAttempt.count({ where: { shipmentId } })).toBe(1);
    await expect(
      prisma.cODTransaction.findUniqueOrThrow({ where: { shipmentId } }),
    ).resolves.toMatchObject({
      status: CODTransactionStatus.COLLECTED,
      expectedAmount: 450_000,
      collectedAmount: 450_000,
    });
    await request(server)
      .get(`/api/v1/shipments/${shipmentId}/location`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(404);
  });

  it('returns one canonical delivered state, immutable payer, complete tracking, and audit history', async () => {
    const customerResponse = await request(server)
      .get(`/api/v1/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(200);
    const customerShipment = bodyFrom<ShipmentPayload>(customerResponse).data;
    const expectedTrackingTypes = [
      'SHIPMENT_CREATED',
      'SHIPMENT_CONFIRMED',
      'AWAITING_PICKUP_ASSIGNMENT',
      'PICKUP_DRIVER_ASSIGNED',
      'PICKUP_IN_PROGRESS',
      'SHIPMENT_PICKED_UP',
      'WAREHOUSE_ORIGIN_CHECK_IN',
      'WAREHOUSE_TRANSFER_DISPATCHED',
      'WAREHOUSE_TRANSFER_RECEIVED',
      'AWAITING_DELIVERY_ASSIGNMENT',
      'DELIVERY_DRIVER_ASSIGNED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    expect(customerShipment).toMatchObject({
      id: shipmentId,
      trackingCode,
      status: ShipmentStatus.DELIVERED,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
      totalFee: originalTotalFee,
      codAmount: 450_000,
    });
    expect(customerShipment.timeline.map(({ type }) => type)).toEqual(expectedTrackingTypes);

    const retryCreateResponse = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${token('customer')}`)
      .send({
        clientRequestId: shipmentClientRequestId,
        pickupAddressId,
        deliveryAddress: {
          contactName: 'Changed receiver must not mutate snapshot',
          phone: '0987000000',
          streetAddress: 'Changed address',
          ward: 'Changed ward',
          district: 'Changed district',
          city: 'Hà Nội',
          latitude: 21.0285,
          longitude: 105.8542,
        },
        package: {
          description: 'Changed package',
          packageType: 'DOCUMENT',
          weightGrams: 500,
          lengthCm: 10,
          widthCm: 10,
          heightCm: 2,
        },
        codAmount: 0,
        shippingFeePayer: ShippingFeePayer.SENDER,
      })
      .expect(201);
    expect(bodyFrom<ShipmentPayload>(retryCreateResponse).data).toMatchObject({
      id: shipmentId,
      status: ShipmentStatus.DELIVERED,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
      codAmount: 450_000,
      totalFee: originalTotalFee,
    });
    expect(await prisma.shipment.count({ where: { id: shipmentId } })).toBe(1);

    for (const actor of ['dispatcher', 'admin'] as const) {
      const operationalResponse = await request(server)
        .get(`/api/v1/dispatcher/shipments/${shipmentId}`)
        .set('Authorization', `Bearer ${token(actor)}`)
        .expect(200);
      expect(bodyFrom<OperationalShipmentPayload>(operationalResponse).data).toMatchObject({
        id: shipmentId,
        trackingCode,
        status: ShipmentStatus.DELIVERED,
        shippingFeePayer: ShippingFeePayer.RECEIVER,
        originWarehouse: { id: originWarehouseId },
        destinationWarehouse: { id: destinationWarehouseId },
        currentWarehouse: { id: destinationWarehouseId },
        pickupAssignment: { id: pickupAssignmentId, status: DriverAssignmentStatus.COMPLETED },
        deliveryAssignment: {
          id: deliveryAssignmentId,
          status: DriverAssignmentStatus.COMPLETED,
        },
      });
    }

    const publicTrackingResponse = await request(server)
      .get(`/api/v1/tracking/${trackingCode}`)
      .expect(200);
    const publicTracking = bodyFrom<{
      status: ShipmentStatus;
      timeline: Array<{ type: string }>;
    }>(publicTrackingResponse).data;
    expect(publicTracking.status).toBe(ShipmentStatus.DELIVERED);
    expect(publicTracking.timeline.map(({ type }) => type)).toEqual(expectedTrackingTypes);

    const expectedAuditActions = [
      'SHIPMENT_CREATE',
      'SHIPMENT_CONFIRM',
      'PICKUP_DRIVER_ASSIGN',
      'PICKUP_ASSIGNMENT_ACCEPT',
      'SHIPMENT_PICKUP',
      'WAREHOUSE_ORIGIN_CHECK_IN',
      'SHIPMENT_DESTINATION_ROUTED',
      'WAREHOUSE_TRANSFER_CREATED',
      'WAREHOUSE_TRANSFER_DISPATCHED',
      'WAREHOUSE_TRANSFER_RECEIVED',
      'SHIPMENT_READY_FOR_DELIVERY',
      'DELIVERY_DRIVER_ASSIGN',
      'DELIVERY_START',
      'DELIVERY_COMPLETE',
    ];
    const auditResponse = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ page: 1, limit: 50 })
      .set('Authorization', `Bearer ${token('admin')}`)
      .expect(200);
    const visibleActions = bodyFrom<{
      items: Array<{ actorId: string | null; action: string }>;
    }>(auditResponse)
      .data.items.filter(({ actorId }) => actorId !== null && userIds.includes(actorId))
      .map(({ action }) => action);
    expect(visibleActions).toEqual(expect.arrayContaining(expectedAuditActions));
    for (const action of expectedAuditActions) {
      expect(await prisma.auditLog.count({ where: { actorId: { in: userIds }, action } })).toBe(1);
    }

    const canonical = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(canonical).toMatchObject({
      status: ShipmentStatus.DELIVERED,
      originWarehouseId,
      destinationWarehouseId,
      currentWarehouseId: destinationWarehouseId,
      shippingFeePayer: ShippingFeePayer.RECEIVER,
      totalFee: originalTotalFee,
      codAmount: 450_000,
    });
    expect(deliveryAttemptId).not.toBe('');
  });

  async function connectCustomerSocket(): Promise<Socket> {
    const address = server.address() as AddressInfo;
    const socket = io(`http://127.0.0.1:${address.port}/operations`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: token('customer') },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5_000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return socket;
  }

  function subscribe(socket: Socket, id: string): Promise<{ subscribed: boolean }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Shipment subscription timed out')), 5_000);
      socket.emit('shipment.subscribe', { shipmentId: id }, (response: { subscribed: boolean }) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  async function expectNoLocationEvent(socket: Socket, action: () => Promise<unknown>) {
    let received = false;
    const listener = () => {
      received = true;
    };
    socket.on('driver.location.updated', listener);
    await action();
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.off('driver.location.updated', listener);
    expect(received).toBe(false);
  }

  function waitForLocationEvent(socket: Socket): Promise<DriverLocationPayload> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('driver.location.updated', listener);
        reject(new Error('Driver location socket event timed out'));
      }, 5_000);
      const listener = (payload: DriverLocationPayload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      socket.once('driver.location.updated', listener);
    });
  }
});
