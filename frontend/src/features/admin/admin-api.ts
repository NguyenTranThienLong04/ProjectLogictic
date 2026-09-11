import { api } from '../../services/api';
import type { ApiEnvelope, User, UserRole, UserStatus } from '../../types/auth';
import type { Paginated } from '../operations/operations-types';

export async function listUsers(params?: {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<User>> {
  const response = await api.get<ApiEnvelope<Paginated<User>>>('/users', {
    params: { page: 1, limit: 20, ...params },
  });
  return response.data.data;
}

export async function setUserStatus(userId: string, status: UserStatus): Promise<User> {
  const response = await api.patch<ApiEnvelope<User>>(`/users/${userId}/status`, { status });
  return response.data.data;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorRole: UserRole;
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export async function listAuditLogs(params?: {
  actorRole?: UserRole;
  actorId?: string;
  action?: string;
  entityType?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<AuditLog>> {
  const response = await api.get<ApiEnvelope<Paginated<AuditLog>>>('/admin/audit-logs', {
    params: { page: 1, limit: 20, ...params },
  });
  return response.data.data;
}
