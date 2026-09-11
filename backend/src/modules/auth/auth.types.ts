import type { UserRole } from '../../generated/prisma/client.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: UserRole;
  ver: number;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
}
