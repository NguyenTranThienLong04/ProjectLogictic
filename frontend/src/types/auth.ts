export type UserRole = 'CUSTOMER' | 'DRIVER' | 'WAREHOUSE_STAFF' | 'DISPATCHER' | 'ADMIN';

export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
}
