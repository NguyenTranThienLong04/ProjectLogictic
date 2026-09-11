import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.getOrThrow<string>('NODE_ENV') !== 'production') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (!origin) return true;

    let suppliedOrigin: string;
    try {
      suppliedOrigin = new URL(origin).origin;
    } catch {
      throw this.forbidden();
    }

    if (suppliedOrigin !== this.config.getOrThrow<string>('FRONTEND_URL')) {
      throw this.forbidden();
    }
    return true;
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'AUTH_ORIGIN_FORBIDDEN',
      message: 'The request origin is not allowed',
    });
  }
}
