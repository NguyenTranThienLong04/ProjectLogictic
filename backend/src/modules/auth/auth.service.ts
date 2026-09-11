import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '../../generated/prisma/client.js';
import { Prisma, UserRole, UserStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { UserResponse } from '../users/user.response.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { TokenService } from './token.service.js';

interface AuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: UserResponse;
}

export interface PasswordResetRequestResult {
  message: string;
  delivery?: {
    requestId: string;
    email: string;
    token: string;
    expiresAt: Date;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const refreshToken = this.tokenService.createOpaqueToken();
    const refreshTokenHash = this.tokenService.hashOpaqueToken(refreshToken);
    const refreshTokenExpiresAt = this.tokenService.getRefreshExpiration();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email,
            passwordHash,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            role: UserRole.CUSTOMER,
          },
        });
        const session = await transaction.authSession.create({
          data: {
            userId: user.id,
            tokenHash: refreshTokenHash,
            expiresAt: refreshTokenExpiresAt,
          },
        });

        return { user, sessionId: session.id };
      });

      return this.buildAuthResult(
        result.user,
        result.sessionId,
        refreshToken,
        refreshTokenExpiresAt,
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });
    const passwordMatches = await this.passwordHasher.verify(dto.password, user?.passwordHash);

    if (!user || !passwordMatches || user.status !== UserStatus.ACTIVE) {
      throw this.invalidCredentials();
    }

    return this.createSession(user);
  }

  async refresh(rawRefreshToken: string | undefined): Promise<AuthResult> {
    if (!rawRefreshToken) {
      throw this.invalidRefreshToken();
    }

    const currentTokenHash = this.tokenService.hashOpaqueToken(rawRefreshToken);
    const nextRefreshToken = this.tokenService.createOpaqueToken();
    const nextTokenHash = this.tokenService.hashOpaqueToken(nextRefreshToken);
    const nextExpiresAt = this.tokenService.getRefreshExpiration();
    const now = new Date();

    const rotated = await this.prisma.$transaction(async (transaction) => {
      const currentSession = await transaction.authSession.findUnique({
        where: { tokenHash: currentTokenHash },
        include: { user: true },
      });

      if (
        !currentSession ||
        currentSession.revokedAt ||
        currentSession.expiresAt <= now ||
        currentSession.user.status !== UserStatus.ACTIVE
      ) {
        return null;
      }

      const revocation = await transaction.authSession.updateMany({
        where: {
          id: currentSession.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revocation.count !== 1) {
        return null;
      }

      const nextSession = await transaction.authSession.create({
        data: {
          userId: currentSession.userId,
          tokenHash: nextTokenHash,
          expiresAt: nextExpiresAt,
        },
      });

      return { user: currentSession.user, sessionId: nextSession.id };
    });

    if (!rotated) {
      throw this.invalidRefreshToken();
    }

    return this.buildAuthResult(rotated.user, rotated.sessionId, nextRefreshToken, nextExpiresAt);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    await this.prisma.authSession.updateMany({
      where: {
        tokenHash: this.tokenService.hashOpaqueToken(rawRefreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<PasswordResetRequestResult> {
    const message = 'If the account exists, the password reset request has been recorded';
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return { message };
    }

    const token = this.tokenService.createOpaqueToken();
    const tokenHash = this.tokenService.hashOpaqueToken(token);
    const expiresAt = this.tokenService.getPasswordResetExpiration();
    const now = new Date();

    const requestId = await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      const request = await transaction.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
      return request.id;
    });

    return {
      message,
      delivery: { requestId, email: user.email, token, expiresAt },
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const tokenHash = this.tokenService.hashOpaqueToken(dto.token);
    const now = new Date();

    const reset = await this.prisma.$transaction(async (transaction) => {
      const resetToken = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
      });

      if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
        return false;
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        return false;
      }

      await transaction.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
      await transaction.authSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return true;
    });

    if (!reset) {
      throw new BadRequestException({
        code: 'AUTH_RESET_TOKEN_INVALID',
        message: 'The password reset token is invalid or expired',
      });
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const passwordMatches = await this.passwordHasher.verify(
      dto.currentPassword,
      user?.passwordHash,
    );

    if (!user || !passwordMatches || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'AUTH_CURRENT_PASSWORD_INVALID',
        message: 'The current password is incorrect',
      });
    }

    const reusesCurrentPassword = await this.passwordHasher.verify(
      dto.newPassword,
      user.passwordHash,
    );
    if (reusesCurrentPassword) {
      throw new BadRequestException({
        code: 'AUTH_PASSWORD_REUSED',
        message: 'The new password must be different from the current password',
      });
    }

    const passwordHash = await this.passwordHasher.hash(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          tokenVersion: user.tokenVersion,
          status: UserStatus.ACTIVE,
        },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          code: 'AUTH_PASSWORD_CHANGED_CONCURRENTLY',
          message: 'Password changed concurrently; sign in again and retry',
        });
      }
      await transaction.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  private async createSession(user: User): Promise<AuthResult> {
    const refreshToken = this.tokenService.createOpaqueToken();
    const tokenHash = this.tokenService.hashOpaqueToken(refreshToken);
    const expiresAt = this.tokenService.getRefreshExpiration();
    const session = await this.prisma.authSession.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return this.buildAuthResult(user, session.id, refreshToken, expiresAt);
  }

  private async buildAuthResult(
    user: User,
    sessionId: string,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): Promise<AuthResult> {
    return {
      accessToken: await this.tokenService.signAccessToken(user, sessionId),
      expiresIn: this.tokenService.getAccessTokenTtlSeconds(),
      refreshToken,
      refreshTokenExpiresAt,
      user: UserResponse.fromUser(user),
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_REFRESH_TOKEN_INVALID',
      message: 'The refresh session is invalid or expired',
    });
  }
}
