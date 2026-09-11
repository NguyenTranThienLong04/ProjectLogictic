import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service.js';
import { UserRole, UserStatus } from '../../../generated/prisma/client.js';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, IS_PUBLIC_KEY } from '../auth.constants.js';
import type { AccessTokenPayload, AuthenticatedUser } from '../auth.types.js';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw this.unauthorized();
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        issuer: this.configService.getOrThrow<string>('JWT_ISSUER'),
        audience: this.configService.getOrThrow<string>('JWT_AUDIENCE'),
      });
    } catch {
      throw this.unauthorized();
    }

    if (
      payload.type !== 'access' ||
      !payload.sub ||
      !payload.sid ||
      !Object.values(UserRole).includes(payload.role)
    ) {
      throw this.unauthorized();
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            mustChangePassword: true,
            tokenVersion: true,
          },
        },
      },
    });
    const user = session?.user;

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.role !== payload.role ||
      user.tokenVersion !== payload.ver
    ) {
      throw this.unauthorized();
    }

    request.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };

    const allowPasswordChangeRequired = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (user.mustChangePassword && !allowPasswordChangeRequired) {
      throw new ForbiddenException({
        code: 'AUTH_PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your temporary password before continuing',
      });
    }

    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : undefined;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_UNAUTHORIZED',
      message: 'Authentication is required',
    });
  }
}
