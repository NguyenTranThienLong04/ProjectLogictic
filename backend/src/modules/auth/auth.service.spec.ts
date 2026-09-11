import { ConflictException } from '@nestjs/common';
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
