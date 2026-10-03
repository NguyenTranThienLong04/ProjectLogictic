import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SmtpSandbox, type SandboxMail } from './helpers/smtp-sandbox.js';

jest.setTimeout(60_000);

interface AuthPayload {
  accessToken: string;
  user: { id: string };
}

function dataFrom<T>(response: Response): T {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error('API response envelope missing');
  }
  return body.data as T;
}

function cookieFrom(response: Response): string {
  const cookie = (response.get('Set-Cookie') ?? []).find((item) =>
    item.startsWith('logistics_refresh='),
  );
  if (!cookie) throw new Error('Refresh cookie missing');
  return cookie.split(';')[0] ?? cookie;
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Sandbox delivery/queue completion timed out');
}

function tokenFrom(mail: SandboxMail): string {
  // Assertions below use booleans so a failed test never prints raw mail/token.
  const match = /http:\/\/localhost:5173\/reset-password\?token=([^\s]+)/.exec(mail.text);
  if (!match) throw new Error('Sandbox mail has no valid configured reset link');
  const url = new URL(match[0]);
  const token = url.searchParams.get('token');
  if (!token || token.length < 32) throw new Error('Sandbox mail token malformed');
  return token;
}

describe('HTTP password reset through real BullMQ and SMTP sandbox (e2e)', () => {
  let app: INestApplication | undefined;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let userId = '';
  let currentAccess = '';
  let currentRefresh = '';
  let knownForgotMessage = '';
  const sandbox = new SmtpSandbox('ci-sandbox-user', 'ci-sandbox-password');
  const email = `smtp-reset-${randomUUID()}@example.com`;
  const oldPassword = 'SandboxOriginal!123';
  const newPassword = 'SandboxReplacement!123';
  const retryPassword = 'SandboxRetryReset!123';

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '');
    const configuredRedis = new URL(process.env.REDIS_URL ?? '');
    if (
      database.hostname !== '127.0.0.1' ||
      database.port !== '55432' ||
      !database.pathname.startsWith('/i1_') ||
      configuredRedis.hostname !== '127.0.0.1' ||
      configuredRedis.port !== '56379'
    ) {
      throw new Error('SMTP E2E requires disposable local i1_* PostgreSQL and Redis port 56379');
    }
    configuredRedis.pathname = '/3';
    const port = await sandbox.listen();
    Object.assign(process.env, {
      REDIS_URL: configuredRedis.toString(),
      EMAIL_DELIVERY_ENABLED: 'true',
      EMAIL_FROM: 'CI Sandbox <no-reply@example.test>',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: 'false',
      SMTP_USER: 'ci-sandbox-user',
      SMTP_PASSWORD: 'ci-sandbox-password',
      SMTP_CONNECTION_TIMEOUT_MS: '3000',
      SMTP_GREETING_TIMEOUT_MS: '3000',
      SMTP_SOCKET_TIMEOUT_MS: '5000',
    });
    // ConfigModule reads env at import time. No providers/adapters/guards are mocked.
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    redis = app.get(RedisService);
    expect(redis.isAvailable()).toBe(true);
  });

  afterAll(async () => {
    try {
      if (app && userId) {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.passwordResetToken.deleteMany({ where: { userId } });
        await prisma.auditLog.deleteMany({ where: { actorId: userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    } finally {
      try {
        await app?.close();
      } finally {
        await sandbox.close();
      }
    }
  });

  async function forgotAndReceive(): Promise<{ token: string; requestId: string }> {
    const before = sandbox.messages.length;
    const response = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(200);
    const data = dataFrom<Record<string, unknown>>(response);
    expect(Object.keys(data)).toEqual(['message']);
    expect(typeof data.message).toBe('string');
    if (typeof data.message === 'string') knownForgotMessage = data.message;
    await waitFor(() => sandbox.messages.length === before + 1);
    const mail = sandbox.messages[before];
    if (!mail) throw new Error('Sandbox delivery missing');
    expect(mail.recipient).toBe(email);
    expect(mail.from).toBe('no-reply@example.test');
    expect(mail.headers.subject).toBe('Reset your Logistics Operations password');
    const token = tokenFrom(mail);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    expect(Boolean(row && row.userId === userId && row.expiresAt > new Date())).toBe(true);
    if (!row) throw new Error('Sandbox token does not match persisted hash');
    expect(row.tokenHash === token).toBe(false);
    expect(mail.headers['message-id']).toBe(`<password-reset-${row.id}@localhost>`);
    expect(mail.headers['x-idempotency-key']).toBe(mail.headers['message-id']);
    await waitFor(
      async () => (await redis.getClient().exists(`bull:email:password-reset-${row.id}`)) === 0,
    );
    return { token, requestId: row.id };
  }

  it('delivers a valid reset link, revokes every old session, and permits only the new password', async () => {
    const registered = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email,
        fullName: 'SMTP Sandbox Customer',
        phone: '+84901234567',
        password: oldPassword,
      })
      .expect(201);
    userId = dataFrom<AuthPayload>(registered).user.id;
    const sessions = [registered];
    for (let i = 0; i < 2; i++) {
      sessions.push(
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: oldPassword })
          .expect(200),
      );
    }
    for (const session of sessions) {
      await request(server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${dataFrom<AuthPayload>(session).accessToken}`)
        .expect(200);
    }
    const { token, requestId } = await forgotAndReceive();
    expect(sandbox.authenticatedConnections).toBeGreaterThan(0);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);
    for (const session of sessions) {
      await request(server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${dataFrom<AuthPayload>(session).accessToken}`)
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieFrom(session))
        .expect(401);
    }
    expect(await prisma.authSession.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(
      Boolean((await prisma.passwordResetToken.findUnique({ where: { id: requestId } }))?.usedAt),
    ).toBe(true);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    const refresh = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieFrom(login))
      .expect(200);
    currentAccess = dataFrom<AuthPayload>(refresh).accessToken;
    currentRefresh = cookieFrom(refresh);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${currentAccess}`)
      .expect(200);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'ReplayDenied!123' })
      .expect(400);
  });

  it('keeps the HTTP response identical for an unknown account without sending mail', async () => {
    const before = sandbox.messages.length;
    const unknown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `unknown-${email}` })
      .expect(200);
    expect(dataFrom<{ message: string }>(unknown).message).toBe(knownForgotMessage);
    expect(sandbox.messages.length).toBe(before);
  });

  it('retries an SMTP temporary failure through BullMQ using the same Message-ID', async () => {
    const before = sandbox.attempts.length;
    sandbox.rejectNextDelivery();
    const { token } = await forgotAndReceive();
    const attempts = sandbox.attempts.slice(before);
    expect(attempts.length).toBe(2);
    expect(attempts.map((attempt) => attempt.accepted)).toEqual([false, true]);
    expect(attempts[0]?.messageId).toBe(attempts[1]?.messageId);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${currentAccess}`)
      .expect(200);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: retryPassword })
      .expect(200);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${currentAccess}`)
      .expect(401);
    await request(server).post('/api/v1/auth/refresh').set('Cookie', currentRefresh).expect(401);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: retryPassword })
      .expect(200);
    currentAccess = dataFrom<AuthPayload>(login).accessToken;
    currentRefresh = cookieFrom(login);
  });

  it('rejects an expired sandbox-delivered token while preserving the existing session', async () => {
    const { token, requestId } = await forgotAndReceive();
    await prisma.passwordResetToken.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'ExpiredDenied!123' })
      .expect(400);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${currentAccess}`)
      .expect(200);
    await request(server).post('/api/v1/auth/refresh').set('Cookie', currentRefresh).expect(200);
  });
});
