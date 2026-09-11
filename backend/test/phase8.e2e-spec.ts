import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ShipmentStatus, TrackingVisibility, UserRole } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { NotificationJobsService } from '../src/modules/notifications/notification-jobs.service.js';
import { CacheService } from '../src/redis/cache.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

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

describe('Phase 8 cache and Notification Center (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let cache: CacheService;
  let jobs: NotificationJobsService;
  let customerToken = '';
  let customerId = '';
  let shipmentId = '';
  let trackingCode = '';
  let otherNotificationId = '';
  const runId = randomUUID().replaceAll('-', '');
  const customerEmail = `customer-p8-${runId}@example.com`;
  const otherEmail = `other-p8-${runId}@example.com`;
  const emails = [customerEmail, otherEmail];

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
    cache = app.get(CacheService);
    jobs = app.get(NotificationJobsService);

    const passwordHash = await app.get(PasswordHasherService).hash('Password@123456');
    const [customer, other] = await Promise.all([
      prisma.user.create({
        data: {
          email: customerEmail,
          fullName: 'Phase 8 Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
      prisma.user.create({
        data: {
          email: otherEmail,
          fullName: 'Other Customer',
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      }),
    ]);
    customerId = customer.id;
    trackingCode = `SHP-P8-${runId.slice(0, 12).toUpperCase()}`;
    const shipment = await prisma.shipment.create({
      data: {
        trackingCode,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: { fullName: customer.fullName, phone: '0900000001' },
        receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
        pickupSnapshot: { streetAddress: '1 Pickup Street', city: 'Ho Chi Minh City' },
        deliverySnapshot: { streetAddress: '2 Delivery Street', city: 'Ha Noi' },
        packageSnapshot: { description: 'Cached parcel', packageType: 'PARCEL', weightGrams: 500 },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        shippingFeeTransaction: { create: { payer: 'SENDER', expectedAmount: 30_000 } },
        status: ShipmentStatus.PENDING,
        trackingEvents: {
          create: {
            status: ShipmentStatus.PENDING,
            type: 'SHIPMENT_CREATED',
            title: 'Shipment created',
            visibility: TrackingVisibility.PUBLIC,
            actorId: customer.id,
          },
        },
      },
    });
    shipmentId = shipment.id;
    const [, otherNotification] = await Promise.all([
      prisma.notification.create({
        data: {
          userId: customer.id,
          eventKey: `phase8:${runId}:customer`,
          type: 'SHIPMENT_CONFIRMED',
          title: 'Shipment confirmed',
          message: 'Your shipment was confirmed',
          data: { shipmentId },
        },
      }),
      prisma.notification.create({
        data: {
          userId: other.id,
          eventKey: `phase8:${runId}:other`,
          type: 'SHIPMENT_CONFIRMED',
          title: 'Private notification',
          message: 'This belongs to another user',
        },
      }),
    ]);
    otherNotificationId = otherNotification.id;

    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: 'Password@123456' })
      .expect(200);
    customerToken = bodyFrom<{ accessToken: string }>(login).data.accessToken;
  });

  afterAll(async () => {
    await redis
      .getClient()
      .del(cache.trackingKey(trackingCode), cache.shipmentSummaryKey(shipmentId));
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId } });
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('caches the two documented keys and invalidates both after a shipment mutation', async () => {
    await request(server).get(`/api/v1/tracking/${trackingCode.toLowerCase()}`).expect(200);
    await request(server)
      .get(`/api/v1/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    await expect(redis.getClient().get(cache.trackingKey(trackingCode))).resolves.not.toBeNull();
    await expect(
      redis.getClient().get(cache.shipmentSummaryKey(shipmentId)),
    ).resolves.not.toBeNull();

    await request(server)
      .post(`/api/v1/shipments/${shipmentId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Phase 8 cache invalidation test' })
      .expect(200);

    await expect(redis.getClient().get(cache.trackingKey(trackingCode))).resolves.toBeNull();
    await expect(redis.getClient().get(cache.shipmentSummaryKey(shipmentId))).resolves.toBeNull();
    const tracking = await request(server).get(`/api/v1/tracking/${trackingCode}`).expect(200);
    expect(bodyFrom<{ status: ShipmentStatus }>(tracking).data.status).toBe(
      ShipmentStatus.CANCELLED,
    );
  });

  it('scopes Notification Center reads and supports idempotent mark-all-read', async () => {
    const list = await request(server)
      .get('/api/v1/notifications?unreadOnly=false')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const listed = bodyFrom<{
      items: Array<{ id: string }>;
      unreadCount: number;
    }>(list).data;
    expect(listed.items).toHaveLength(1);
    expect(listed.unreadCount).toBe(1);

    await request(server)
      .patch(`/api/v1/notifications/${otherNotificationId}/read`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);

    const marked = await request(server)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<{ markedCount: number }>(marked).data.markedCount).toBe(1);
    const retried = await request(server)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<{ markedCount: number }>(retried).data.markedCount).toBe(0);

    const unread = await request(server)
      .get('/api/v1/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(bodyFrom<{ items: unknown[] }>(unread).data.items).toHaveLength(0);
  });

  it('delivers notification.created through BullMQ to the authenticated user room', async () => {
    const address = server.address() as AddressInfo;
    const socket = io(`http://127.0.0.1:${address.port}/operations`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const notification = await prisma.notification.create({
      data: {
        userId: customerId,
        eventKey: `phase8:${runId}:socket`,
        type: 'SHIPMENT_CONFIRMED',
        title: 'Realtime notification',
        message: 'Delivered by BullMQ',
      },
    });
    const received = new Promise<{ id: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('notification.created timed out')), 10_000);
      socket.once('notification.created', (payload: { id: string }) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    await jobs.enqueueNotifications([notification]);

    await expect(received).resolves.toMatchObject({ id: notification.id });
    socket.disconnect();
  });
});
