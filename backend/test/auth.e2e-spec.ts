import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(60_000);

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
  meta: Record<string, unknown>;
}

interface AuthPayload {
  accessToken: string;
  user: {
    role: UserRole;
    passwordHash?: unknown;
  };
}

interface UserPayload {
  fullName: string;
  mustChangePassword: boolean;
}

interface MessagePayload {
  message: string;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;

  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error('API response envelope is missing');
  }

  return body as ApiEnvelope<T>;
}

function cookieFrom(response: Response): string {
  const values = response.get('Set-Cookie') ?? [];
  const cookie = values.find((value) => value.startsWith('logistics_refresh='));

  if (!cookie) {
    throw new Error('Refresh cookie was not returned');
  }

  return cookie.split(';')[0] ?? cookie;
}

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let authService: AuthService;
  let passwordHasher: PasswordHasherService;
  const runId = randomUUID().replaceAll('-', '');
  const customerEmail = `customer-${runId}@example.com`;
  const adminEmail = `admin-${runId}@example.com`;
  const staffEmail = `dispatcher-${runId}@example.com`;
  const testEmails = [customerEmail, adminEmail, staffEmail];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');

    const { ValidationPipe } = await import('@nestjs/common');
    const cookieParser = (await import('cookie-parser')).default;
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    passwordHasher = app.get(PasswordHasherService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await app.close();
  });

  it('runs customer auth, refresh rotation, reset, RBAC and staff password change', async () => {
    const registerResponse = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: customerEmail,
        fullName: 'Customer Test',
        phone: '+84901234567',
        password: 'CustomerPass!123',
      })
      .expect(201);

    const registerBody = bodyFrom<AuthPayload>(registerResponse).data;
    expect(registerBody.user.role).toBe(UserRole.CUSTOMER);
    expect(registerBody.user.passwordHash).toBeUndefined();
    expect('refreshToken' in registerBody).toBe(false);
    const firstAccessToken = registerBody.accessToken;
    const firstRefreshCookie = cookieFrom(registerResponse);

    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .expect(200);

    await request(server)
      .post('/api/v1/users/staff')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .send({
        email: staffEmail,
        fullName: 'Forbidden Staff',
        role: UserRole.DISPATCHER,
        temporaryPassword: 'TemporaryPass!123',
      })
      .expect(403);

    const refreshResponse = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(200);
    const secondAccessToken = bodyFrom<AuthPayload>(refreshResponse).data.accessToken;
    const secondRefreshCookie = cookieFrom(refreshResponse);

    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(401);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .expect(401);

    await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', secondRefreshCookie)
      .expect(200);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${secondAccessToken}`)
      .expect(401);

    const unknownReset = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `unknown-${runId}@example.com` })
      .expect(200);
    const resetRequest = await authService.requestPasswordReset({ email: customerEmail });
    expect(resetRequest.message).toBe(bodyFrom<MessagePayload>(unknownReset).data.message);
    expect(resetRequest.delivery).toBeDefined();

    const resetToken = resetRequest.delivery?.token;
    if (!resetToken) {
      throw new Error('Reset token delivery boundary did not receive a token');
    }

    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'NewCustomerPass!123' })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'AnotherCustomer!123' })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: 'CustomerPass!123' })
      .expect(401);
    const customerLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: 'NewCustomerPass!123' })
      .expect(200);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'Admin Test',
        role: UserRole.ADMIN,
        passwordHash: await passwordHasher.hash('AdminPassword!123'),
      },
    });
    expect(admin.role).toBe(UserRole.ADMIN);

    const adminLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'AdminPassword!123' })
      .expect(200);
    const adminAccessToken = bodyFrom<AuthPayload>(adminLogin).data.accessToken;

    const staffCreate = await request(server)
      .post('/api/v1/users/staff')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        email: staffEmail,
        fullName: 'Dispatcher Test',
        role: UserRole.DISPATCHER,
        temporaryPassword: 'TemporaryPass!123',
      })
      .expect(201);
    expect(bodyFrom<UserPayload>(staffCreate).data.mustChangePassword).toBe(true);

    const staffLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: 'TemporaryPass!123' })
      .expect(200);
    const staffAccessToken = bodyFrom<AuthPayload>(staffLogin).data.accessToken;

    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${staffAccessToken}`)
      .expect(200);
    await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${staffAccessToken}`)
      .send({ fullName: 'Blocked Until Password Change' })
      .expect(403);
    await request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${staffAccessToken}`)
      .send({
        currentPassword: 'TemporaryPass!123',
        newPassword: 'PermanentPass!123',
      })
      .expect(200);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${staffAccessToken}`)
      .expect(401);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: staffEmail, password: 'PermanentPass!123' })
      .expect(200);

    const customerAccessToken = bodyFrom<AuthPayload>(customerLogin).data.accessToken;
    const profileUpdate = await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({ fullName: 'Updated Customer' })
      .expect(200);
    expect(bodyFrom<UserPayload>(profileUpdate).data.fullName).toBe('Updated Customer');
  });
});
