import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { NotificationJobsService } from '../notifications/notification-jobs.service.js';
import { UserRole, UserStatus } from '../../generated/prisma/client.js';

describe('refresh HTTP cookie boundary (service mocked)', () => {
  let app: INestApplication;
  let server: Server;
  const origin = 'https://logistics-staging-web.onrender.com';
  const result = {
    accessToken: 'test-access',
    expiresIn: 900,
    refreshToken: 'test-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    user: {
      id: 'customer',
      email: 'customer@example.test',
      fullName: 'Customer',
      phone: null,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  const service = {
    login: jest.fn<AuthService['login']>().mockResolvedValue(result),
    refresh: jest.fn<AuthService['refresh']>(),
    logout: jest.fn<AuthService['logout']>().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        { provide: NotificationJobsService, useValue: {} },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'production',
            FRONTEND_URL: origin,
            REFRESH_COOKIE_NAME: '__Secure-logistics_refresh',
            REFRESH_COOKIE_SAME_SITE: 'none',
          }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.enableCors({ origin, credentials: true });
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    service.refresh.mockReset().mockResolvedValue(result);
  });

  it.each(['login', 'refresh'])(
    '%s sets a host-only cookie matching the versioned refresh path',
    async (path) => {
      const response = await request(server)
        .post(`/api/v1/auth/${path}`)
        .set('Origin', origin)
        .set('Cookie', '__Secure-logistics_refresh=old-test-token')
        .send({})
        .expect(200);
      const cookie = response.get('Set-Cookie')?.[0] ?? '';
      expect(cookie).toContain('__Secure-logistics_refresh=');
      expect(cookie).toContain('Path=/api/v1/auth;');
      expect(cookie).toContain('HttpOnly; Secure; SameSite=None');
      expect(cookie).not.toContain('Domain=');
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.body).not.toHaveProperty('refreshToken');
      if (path === 'refresh') expect(service.refresh).toHaveBeenCalledWith('old-test-token');
    },
  );

  it('preserves the auth-invalid code and does not delete another rotated cookie', async () => {
    service.refresh.mockRejectedValue(
      new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        message: 'Invalid refresh token',
      }),
    );
    const response = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .expect(401);
    expect(response.body).toHaveProperty('code', 'AUTH_REFRESH_TOKEN_INVALID');
    expect(response.get('Set-Cookie')).toBeUndefined();
    expect(service.refresh).toHaveBeenCalledWith(undefined);
  });

  it('rejects untrusted cross-site origins before rotating', async () => {
    const response = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://attacker.example')
      .expect(403);
    expect(response.body).toHaveProperty('code', 'AUTH_ORIGIN_FORBIDDEN');
    expect(service.refresh).not.toHaveBeenCalled();
  });

  it('logout clears exactly the same cookie scope', async () => {
    const response = await request(server)
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', '__Secure-logistics_refresh=current-test-token')
      .expect(200);
    expect(service.logout).toHaveBeenCalledWith('current-test-token');
    const cookie = response.get('Set-Cookie')?.[0] ?? '';
    expect(cookie).toContain('__Secure-logistics_refresh=; Path=/api/v1/auth;');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(cookie).toContain('HttpOnly; Secure; SameSite=None');
  });
});
