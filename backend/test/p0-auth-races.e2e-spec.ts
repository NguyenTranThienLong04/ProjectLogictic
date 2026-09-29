import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(30_000);

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('P0 credential/session concurrency on real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let hasher: PasswordHasherService;
  let tokens: TokenService;
  const password = 'Original@Password123';
  const newPassword = 'Changed@Password456';

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    const ciDatabase =
      process.env.CI === 'true' && url.hostname === '127.0.0.1' && url.pathname === '/i1_e2e';
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55432' ||
      (!/^\/p0_regression_\d+$/.test(url.pathname) && !ciDatabase)
    ) {
      throw new Error('Requires isolated localhost P0 or CI E2E database on port 55432');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        getClient: () => ({
          status: 'ready',
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          quit: jest.fn(),
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    hasher = app.get(PasswordHasherService);
    tokens = app.get(TokenService);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  async function createUser() {
    return prisma.user.create({
      data: {
        email: `p0-${randomUUID()}@example.test`,
        fullName: 'P0 concurrency',
        passwordHash: await hasher.hash(password),
      },
    });
  }

  async function mutateCredential(kind: string, id: string, email: string) {
    if (kind === 'change') {
      await auth.changePassword(id, { currentPassword: password, newPassword });
    } else {
      const reset = await auth.requestPasswordReset({ email });
      await auth.resetPassword({ token: reset.delivery!.token, password: newPassword });
    }
  }

  async function assertRejectedSession(result: Awaited<ReturnType<AuthService['login']>>) {
    await expect(auth.refresh(result.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${result.accessToken}`)
      .expect(401);
  }

  it.each(['change', 'reset'])(
    'blocks in-flight old-password login after password %s commits',
    async (kind) => {
      const user = await createUser();
      const old = await auth.login({ email: user.email, password });
      const verified = barrier();
      const resume = barrier();
      const verify = hasher.verify.bind(hasher);
      jest.spyOn(hasher, 'verify').mockImplementationOnce(async (plain, hash) => {
        const matched = await verify(plain, hash);
        verified.release();
        await resume.promise;
        return matched;
      });
      const pending = auth.login({ email: user.email, password }).catch((error: unknown) => error);
      try {
        await verified.promise;
        await mutateCredential(kind, user.id, user.email);
      } finally {
        resume.release();
      }
      expect(await pending).toBeInstanceOf(UnauthorizedException);
      expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(
        0,
      );
      await assertRejectedSession(old);
      const current = await auth.login({ email: user.email, password: newPassword });
      const refreshed = await auth.refresh(current.refreshToken);
      await request(app.getHttpServer() as Server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${refreshed.accessToken}`)
        .expect(200);
      await assertRejectedSession(current);
    },
  );

  it.each(['change', 'reset'])(
    'revokes login that committed just before password %s while response is in flight',
    async (kind) => {
      const user = await createUser();
      const committed = barrier();
      const resume = barrier();
      const sign = tokens.signAccessToken.bind(tokens);
      jest.spyOn(tokens, 'signAccessToken').mockImplementationOnce(async (...args) => {
        committed.release();
        await resume.promise;
        return sign(...args);
      });
      const pending = auth.login({ email: user.email, password });
      try {
        await committed.promise;
        await mutateCredential(kind, user.id, user.email);
      } finally {
        resume.release();
      }
      await assertRejectedSession(await pending);
      expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(
        0,
      );
    },
  );

  it('does not rotate a session revoked after refresh read while waiting for the User lock', async () => {
    const user = await createUser();
    const session = await auth.login({ email: user.email, password });
    const locked = barrier();
    const resume = barrier();
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        locked.release();
        await resume.promise;
      },
      { timeout: 15_000 },
    );
    await locked.promise;
    const refreshing = auth.refresh(session.refreshToken).catch((error: unknown) => error);
    try {
      const deadline = Date.now() + 10_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE 'SELECT "id" FROM "User"%FOR UPDATE%') AS waiting`;
        waiting = rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await auth.logout(session.refreshToken);
    } finally {
      resume.release();
      await holding;
    }
    expect(await refreshing).toBeInstanceOf(UnauthorizedException);
    expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('keeps normal login and single-winner refresh rotation working', async () => {
    const user = await createUser();
    const session = await auth.login({ email: user.email, password });
    const rotations = await Promise.allSettled([
      auth.refresh(session.refreshToken),
      auth.refresh(session.refreshToken),
    ]);
    expect(rotations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rotations.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });
});
