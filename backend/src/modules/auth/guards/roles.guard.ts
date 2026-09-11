import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../../../generated/prisma/client.js';
import { ROLES_KEY } from '../auth.constants.js';
import type { AuthenticatedUser } from '../auth.types.js';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'AUTH_FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }

    return true;
  }
}
