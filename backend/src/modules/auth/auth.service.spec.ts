import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { UserRole, UserStatus } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { PasswordHasherService } from './password-hasher.service.js';
import type { TokenService } from './token.service.js';

describe('AuthService concurrency', () => {
  it('does not overwrite a password changed by a concurrent request', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'customer@example.test',
      passwordHash: 'old-hash',
      fullName: 'Customer',
      phone: null,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      tokenVersion: 4,
      passwordChangedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const transaction = {
      user: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      authSession: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
    };
    const prisma = {
      user: { findUnique: jest.fn(() => Promise.resolve(user)) },
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const passwordHasher = {
      verify: jest
        .fn<(plainText: string, storedHash: string | undefined) => Promise<boolean>>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      hash: jest.fn(() => Promise.resolve('new-hash')),
    } as unknown as PasswordHasherService;
    const service = new AuthService(prisma, passwordHasher, {} as TokenService);

    await expect(
      service.changePassword(user.id, {
        currentPassword: 'Current-password-1',
        newPassword: 'New-password-2',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.authSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService refresh validity and atomic rotation (repository mocked)', () => {
  function setup(role: UserRole = UserRole.CUSTOMER) {
    const current = {
      id: 'old-session',
      userId: 'test-user',
      tokenHash: 'hash-old',
      revokedAt: null as Date | null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'test-user',
        role,
        status: UserStatus.ACTIVE as UserStatus,
        tokenVersion: 0,
        email: 'test@example.test',
        fullName: 'Test User',
        phone: null,
        passwordHash: 'test-hash',
        mustChangePassword: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordChangedAt: null,
      },
    };
    const transaction = {
      authSession: {
        findUnique: jest.fn<() => Promise<typeof current | null>>().mockResolvedValue(current),
        updateMany: jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: 'new-session' })),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const tokens = {
      hashOpaqueToken: jest.fn((raw: string) => `hash-${raw}`),
      createOpaqueToken: jest.fn(() => 'new'),
      getRefreshExpiration: jest.fn(() => new Date(Date.now() + 86_400_000)),
      signAccessToken: jest.fn(() => Promise.resolve('new-access')),
      getAccessTokenTtlSeconds: jest.fn(() => 900),
    };
    const service = new AuthService(
      prisma,
      {} as PasswordHasherService,
      tokens as unknown as TokenService,
    );
    return { current, transaction, tokens, service };
  }

  it.each([UserRole.CUSTOMER, UserRole.ADMIN, UserRole.DRIVER])(
    'restores %s using only a valid refresh session, with a new hash and access token',
    async (role) => {
      const { service, transaction, tokens } = setup(role);
      const result = await service.refresh('old');
      expect(result.user.role).toBe(role);
      expect(result.accessToken).toBe('new-access');
      expect(transaction.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'old-session', revokedAt: null }) as unknown,
        }),
      );
      expect(transaction.authSession.create).toHaveBeenCalledWith({
        data: {
          userId: 'test-user',
          tokenHash: 'hash-new',
          expiresAt: expect.any(Date) as Date,
        },
      });
      expect(tokens.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
        'new-session',
      );
    },
  );

  it.each(['missing', 'unknown', 'expired', 'revoked', 'suspended', 'rotation-loser'])(
    'rejects %s without minting another session',
    async (kind) => {
      const { service, current, transaction, tokens } = setup();
      if (kind === 'unknown') transaction.authSession.findUnique.mockResolvedValue(null);
      if (kind === 'expired') current.expiresAt = new Date(0);
      if (kind === 'revoked') current.revokedAt = new Date();
      if (kind === 'suspended') current.user.status = UserStatus.SUSPENDED;
      if (kind === 'rotation-loser')
        transaction.authSession.updateMany.mockResolvedValue({ count: 0 });
      const error = await service
        .refresh(kind === 'missing' ? undefined : 'old')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'AUTH_REFRESH_TOKEN_INVALID',
      });
      expect(transaction.authSession.create).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    },
  );

  it('propagates database failure instead of claiming the session is invalid', async () => {
    const { service, transaction } = setup();
    const unavailable = new Error('database unavailable');
    transaction.authSession.findUnique.mockRejectedValue(unavailable);
    await expect(service.refresh('old')).rejects.toBe(unavailable);
  });
});
