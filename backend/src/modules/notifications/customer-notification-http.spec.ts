import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'node:http';
import { ApiResponseInterceptor } from '../../common/interceptors/api-response.interceptor.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CacheService } from '../../redis/cache.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ShipmentsController } from '../shipments/shipments.controller.js';
import { ShipmentsService } from '../shipments/shipments.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

describe('Customer notification → shipment HTTP boundary (repositories/cache mocked)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const customerId = '30000000-0000-4000-8000-000000000001';
  const shipmentId = '30000000-0000-4000-8000-000000000002';
  const notificationId = '30000000-0000-4000-8000-000000000003';
  const secret = 'customer-notification-test-only-secret';
  const session = {
    userId: customerId,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: customerId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      tokenVersion: 0,
      mustChangePassword: false,
    },
  };
  const notification = {
    id: notificationId,
    userId: customerId,
    type: 'DELIVERY_DRIVER_ASSIGNED',
    data: { shipmentId, assignmentId: '30000000-0000-4000-8000-000000000004' },
    readAt: null,
  };
  const findOwned = jest.fn<PrismaService['shipment']['findFirst']>();
  const listNotifications = jest.fn(() => Promise.resolve([notification]));
  const markRead = jest.fn(() => Promise.resolve({ count: 0 }));
  const findNotification = jest.fn(() => Promise.resolve(null));
  const getCache = jest.fn(() =>
    Promise.resolve({
      id: shipmentId,
      trackingCode: 'SHP-OWNED',
      shippingFee: { status: 'COLLECTED' },
      timeline: [],
    }),
  );
  const prisma = {
    authSession: { findUnique: () => Promise.resolve(session) },
    shipment: { findFirst: findOwned },
    notification: {
      findMany: listNotifications,
      count: () => Promise.resolve(1),
      updateMany: markRead,
      findFirst: findNotification,
    },
  } as unknown as PrismaService;

  beforeAll(async () => {
    const notifications = new NotificationsService(prisma, {} as never, {} as never, {} as never);
    const shipments = new ShipmentsService(
      prisma,
      {} as never,
      {} as never,
      {
        shipmentSummaryKey: (id: string) => `shipment:${id}`,
        get: getCache,
      } as unknown as CacheService,
      notifications,
      {} as never,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [NotificationsController, ShipmentsController],
      providers: [
        { provide: NotificationsService, useValue: notifications },
        { provide: ShipmentsService, useValue: shipments },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_ACCESS_SECRET: secret,
            JWT_ISSUER: 'test',
            JWT_AUDIENCE: 'test',
          }),
        },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    session.user.role = 'CUSTOMER';
    findOwned.mockResolvedValue(null);
  });
  const token = () =>
    jwt.sign(
      { sub: customerId, sid: 'test-session', role: session.user.role, ver: 0, type: 'access' },
      {
        secret,
        issuer: 'test',
        audience: 'test',
        expiresIn: '1m',
        algorithm: 'HS256',
      },
    );
  const http = () => app.getHttpServer() as Server;

  it('preserves notification type and entity metadata in the scoped API envelope', async () => {
    const response = await request(http())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(response.body).toMatchObject({ data: { items: [notification], unreadCount: 1 } });
    expect(listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: customerId } }),
    );
  });

  it('opens owned detail through the real controller/service and checks ownership before cache', async () => {
    findOwned.mockResolvedValue({ id: shipmentId, codTransaction: null } as never);
    const response = await request(http())
      .get(`/api/v1/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(response.body).toMatchObject({ data: { id: shipmentId, trackingCode: 'SHP-OWNED' } });
    expect(findOwned).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: shipmentId, customerId } }),
    );
    expect(findOwned.mock.invocationCallOrder[0]).toBeLessThan(
      getCache.mock.invocationCallOrder[0],
    );
  });

  it('rejects another Customer shipment with 404 even when a cached detail exists', async () => {
    const response = await request(http())
      .get(`/api/v1/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
    expect(response.body).toMatchObject({ code: 'SHIPMENT_NOT_FOUND' });
    expect(findOwned).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: shipmentId, customerId } }),
    );
    expect(getCache).not.toHaveBeenCalled();
  });

  it('rejects marking another user notification read', async () => {
    await request(http())
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
    expect(markRead).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: notificationId, userId: customerId, readAt: null } }),
    );
    expect(findNotification).toHaveBeenCalledWith({
      where: { id: notificationId, userId: customerId },
    });
  });

  it('rejects unauthenticated and non-Customer detail reads and invalid IDs', async () => {
    await request(http()).get(`/api/v1/shipments/${shipmentId}`).expect(401);
    for (const role of ['DRIVER', 'ADMIN', 'DISPATCHER']) {
      session.user.role = role;
      await request(http())
        .get(`/api/v1/shipments/${shipmentId}`)
        .set('Authorization', `Bearer ${token()}`)
        .expect(403);
    }
    session.user.role = 'CUSTOMER';
    await request(http())
      .get('/api/v1/shipments/invalid')
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
    expect(findOwned).not.toHaveBeenCalled();
    expect(getCache).not.toHaveBeenCalled();
  });
});
