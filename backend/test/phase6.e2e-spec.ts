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
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  ShipmentStatus,
  UserRole,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

interface ApiEnvelope<T> {
  data: T;
}

interface LocationPayload {
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

describe('Phase 6 Realtime GPS authorization (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  const sockets: Socket[] = [];
  const runId = randomUUID().replaceAll('-', '');
  const password = 'Password@123456';
  const emails = {
    dispatcher: `dispatcher-p6-${runId}@example.com`,
    driver: `driver-p6-${runId}@example.com`,
    otherDriver: `other-driver-p6-${runId}@example.com`,
    customer: `customer-p6-${runId}@example.com`,
    otherCustomer: `other-customer-p6-${runId}@example.com`,
  };
  let driverProfileId = '';
  let outForDeliveryShipmentId = '';
  let waitingShipmentId = '';
  let dispatcherToken = '';
  let driverToken = '';
  let otherDriverToken = '';
  let customerToken = '';
  let otherCustomerToken = '';

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

    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const [dispatcher, driver, otherDriver, customer, otherCustomer] = await Promise.all([
      prisma.user.create({
        data: {
          email: emails.dispatcher,
          fullName: 'Phase 6 Dispatcher',
          passwordHash,
          role: UserRole.DISPATCHER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.driver,
          fullName: 'Phase 6 Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.otherDriver,
          fullName: 'Phase 6 Other Driver',
          passwordHash,
          role: UserRole.DRIVER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.customer,
          fullName: 'Phase 6 Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: emails.otherCustomer,
          fullName: 'Phase 6 Other Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
    ]);

    const [driverProfile, otherDriverProfile] = await Promise.all([
      prisma.driverProfile.create({
        data: {
          userId: driver.id,
          employeeCode: `DRV-P6-${runId.slice(0, 12).toUpperCase()}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `59P6-${runId.slice(0, 5).toUpperCase()}`,
          status: DriverStatus.BUSY,
          isOnline: true,
          isAvailable: false,
        },
      }),
      prisma.driverProfile.create({
        data: {
          userId: otherDriver.id,
          employeeCode: `DRV-P6-O-${runId.slice(0, 10).toUpperCase()}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `59PX-${runId.slice(0, 5).toUpperCase()}`,
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        },
      }),
    ]);
    driverProfileId = driverProfile.id;

    const shipmentData = {
      senderSnapshot: { fullName: 'Sender', phone: '0900000001' },
      receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
      pickupSnapshot: { streetAddress: '1 Pickup Street', city: 'Ho Chi Minh City' },
      deliverySnapshot: { streetAddress: '2 Delivery Street', city: 'Ho Chi Minh City' },
      packageSnapshot: { description: 'GPS parcel', packageType: 'PARCEL', weightGrams: 500 },
      pricingSnapshot: { totalFee: 30_000 },
      totalFee: 30_000,
    };
    const [outForDelivery, waiting] = await Promise.all([
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-P6-${runId.slice(0, 12).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: customer.id,
          status: ShipmentStatus.OUT_FOR_DELIVERY,
        },
      }),
      prisma.shipment.create({
        data: {
          ...shipmentData,
          trackingCode: `SHP-P6-W-${runId.slice(0, 10).toUpperCase()}`,
          clientRequestId: randomUUID(),
          customerId: otherCustomer.id,
          status: ShipmentStatus.DELIVERY_ASSIGNED,
        },
      }),
    ]);
    outForDeliveryShipmentId = outForDelivery.id;
    waitingShipmentId = waiting.id;

    await prisma.driverAssignment.createMany({
      data: [
        {
          shipmentId: outForDelivery.id,
          driverId: driverProfile.id,
          type: DriverAssignmentType.DELIVERY,
          status: DriverAssignmentStatus.ACCEPTED,
          clientRequestId: randomUUID(),
          assignedById: dispatcher.id,
          acceptedAt: new Date(),
        },
        {
          shipmentId: outForDelivery.id,
          driverId: otherDriverProfile.id,
          type: DriverAssignmentType.PICKUP,
          status: DriverAssignmentStatus.COMPLETED,
          clientRequestId: randomUUID(),
          assignedById: dispatcher.id,
          completedAt: new Date(),
        },
      ],
    });

    const login = async (email: string): Promise<string> => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return bodyFrom<{ accessToken: string }>(response).data.accessToken;
    };
    [dispatcherToken, driverToken, otherDriverToken, customerToken, otherCustomerToken] =
      await Promise.all([
        login(emails.dispatcher),
        login(emails.driver),
        login(emails.otherDriver),
        login(emails.customer),
        login(emails.otherCustomer),
      ]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (driverProfileId) await redis.getClient().del(`driver:location:${driverProfileId}`);
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const shipmentIds = [outForDeliveryShipmentId, waitingShipmentId].filter(Boolean);
    if (shipmentIds.length > 0) {
      await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('stores driver GPS with TTL and broadcasts only to operations and the owned out-for-delivery shipment', async () => {
    const [dispatcherSocket, customerSocket, otherCustomerSocket, otherDriverSocket] =
      await Promise.all([
        connect(dispatcherToken),
        connect(customerToken),
        connect(otherCustomerToken),
        connect(otherDriverToken),
      ]);

    await expect(subscribe(customerSocket, outForDeliveryShipmentId)).resolves.toEqual({
      subscribed: true,
    });
    await expect(subscribe(otherCustomerSocket, outForDeliveryShipmentId)).resolves.toEqual({
      subscribed: false,
    });
    await expect(subscribe(otherCustomerSocket, waitingShipmentId)).resolves.toEqual({
      subscribed: true,
    });
    await expect(subscribe(otherDriverSocket, outForDeliveryShipmentId)).resolves.toEqual({
      subscribed: false,
    });

    const dispatcherEvents: LocationPayload[] = [];
    const customerEvents: LocationPayload[] = [];
    const otherCustomerEvents: LocationPayload[] = [];
    const otherDriverEvents: LocationPayload[] = [];
    dispatcherSocket.on('driver.location.updated', (payload: LocationPayload) =>
      dispatcherEvents.push(payload),
    );
    customerSocket.on('driver.location.updated', (payload: LocationPayload) =>
      customerEvents.push(payload),
    );
    otherCustomerSocket.on('driver.location.updated', (payload: LocationPayload) =>
      otherCustomerEvents.push(payload),
    );
    otherDriverSocket.on('driver.location.updated', (payload: LocationPayload) =>
      otherDriverEvents.push(payload),
    );

    const firstDispatcherEvent = nextLocation(dispatcherSocket);
    const firstCustomerEvent = nextLocation(customerSocket);
    const firstLocation = { latitude: 10.7769, longitude: 106.7009 };
    await request(server)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(firstLocation)
      .expect(200);

    await expect(firstDispatcherEvent).resolves.toMatchObject({
      driverId: driverProfileId,
      ...firstLocation,
    });
    await expect(firstCustomerEvent).resolves.toMatchObject({
      driverId: driverProfileId,
      ...firstLocation,
    });

    const key = `driver:location:${driverProfileId}`;
    const [storedValue, ttl] = await Promise.all([
      redis.getClient().get(key),
      redis.getClient().pttl(key),
    ]);
    expect(storedValue).not.toBeNull();
    expect(JSON.parse(storedValue ?? '{}')).toMatchObject({
      driverId: driverProfileId,
      ...firstLocation,
    });
    expect(ttl).toBeGreaterThan(15_000);
    expect(ttl).toBeLessThanOrEqual(20_000);
    await settleEvents();
    expect(dispatcherEvents).toHaveLength(1);
    expect(customerEvents).toHaveLength(1);
    expect(otherCustomerEvents).toHaveLength(0);
    expect(otherDriverEvents).toHaveLength(0);

    await prisma.shipment.update({
      where: { id: outForDeliveryShipmentId },
      data: { status: ShipmentStatus.DELIVERED, version: { increment: 1 } },
    });
    const secondDispatcherEvent = nextLocation(dispatcherSocket);
    const secondLocation = { latitude: 10.778, longitude: 106.702 };
    await request(server)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(secondLocation)
      .expect(200);
    await expect(secondDispatcherEvent).resolves.toMatchObject(secondLocation);
    await settleEvents();

    expect(dispatcherEvents).toHaveLength(2);
    expect(customerEvents).toHaveLength(1);
    expect(otherCustomerEvents).toHaveLength(0);
    expect(otherDriverEvents).toHaveLength(0);
  });

  async function connect(token: string): Promise<Socket> {
    const address = server.address() as AddressInfo;
    const socket = io(`http://127.0.0.1:${address.port}/operations`, {
      auth: { token },
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function subscribe(socket: Socket, shipmentId: string): Promise<{ subscribed: boolean }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('shipment.subscribe timed out')), 5_000);
      socket.emit('shipment.subscribe', { shipmentId }, (response: { subscribed: boolean }) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  function nextLocation(socket: Socket): Promise<LocationPayload> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('driver.location.updated timed out')),
        10_000,
      );
      socket.once('driver.location.updated', (payload: LocationPayload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  }

  function settleEvents(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250));
  }
});
