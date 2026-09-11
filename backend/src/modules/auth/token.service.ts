import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { UserRole } from '../../generated/prisma/client.js';
import type { AccessTokenPayload } from './auth.types.js';

interface AccessTokenUser {
  id: string;
  role: UserRole;
  tokenVersion: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  createOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  getRefreshExpiration(now = new Date()): Date {
    const days = Number(this.configService.getOrThrow<string>('REFRESH_TOKEN_TTL_DAYS'));
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  getPasswordResetExpiration(now = new Date()): Date {
    const minutes = Number(this.configService.getOrThrow<string>('PASSWORD_RESET_TTL_MINUTES'));
    return new Date(now.getTime() + minutes * 60 * 1000);
  }

  getAccessTokenTtlSeconds(): number {
    return Number(this.configService.getOrThrow<string>('ACCESS_TOKEN_TTL_SECONDS'));
  }

  async signAccessToken(user: AccessTokenUser, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      sid: sessionId,
      role: user.role,
      ver: user.tokenVersion,
      type: 'access',
    };

    return this.jwtService.signAsync(payload, {
      algorithm: 'HS256',
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: this.configService.getOrThrow<string>('JWT_ISSUER'),
      audience: this.configService.getOrThrow<string>('JWT_AUDIENCE'),
      expiresIn: this.getAccessTokenTtlSeconds(),
    });
  }
}
