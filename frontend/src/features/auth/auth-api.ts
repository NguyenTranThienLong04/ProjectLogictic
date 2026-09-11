import { api, authApi } from '../../services/api';
import type { ApiEnvelope, AuthPayload, User, UserRole } from '../../types/auth';

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  fullName: string;
  phone?: string;
}

export interface CreateStaffInput {
  email: string;
  fullName: string;
  phone?: string;
  role: Exclude<UserRole, 'CUSTOMER'>;
  temporaryPassword: string;
}

export async function login(input: LoginInput): Promise<AuthPayload> {
  const response = await authApi.post<ApiEnvelope<AuthPayload>>('/auth/login', input);
  return response.data.data;
}

export async function register(input: RegisterInput): Promise<AuthPayload> {
  const response = await authApi.post<ApiEnvelope<AuthPayload>>('/auth/register', input);
  return response.data.data;
}

export async function logout(): Promise<void> {
  await authApi.post('/auth/logout');
}

export async function forgotPassword(email: string): Promise<string> {
  const response = await authApi.post<ApiEnvelope<{ message: string }>>('/auth/forgot-password', {
    email,
  });
  return response.data.data.message;
}

export async function resetPassword(token: string, password: string): Promise<string> {
  const response = await authApi.post<ApiEnvelope<{ message: string }>>('/auth/reset-password', {
    token,
    password,
  });
  return response.data.data.message;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const response = await api.post<ApiEnvelope<{ message: string }>>('/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return response.data.data.message;
}

export async function getProfile(): Promise<User> {
  const response = await api.get<ApiEnvelope<User>>('/users/me');
  return response.data.data;
}

export async function updateProfile(input: {
  fullName: string;
  phone: string | null;
}): Promise<User> {
  const response = await api.patch<ApiEnvelope<User>>('/users/me', input);
  return response.data.data;
}

export async function createStaff(input: CreateStaffInput): Promise<User> {
  const response = await api.post<ApiEnvelope<User>>('/users/staff', input);
  return response.data.data;
}
