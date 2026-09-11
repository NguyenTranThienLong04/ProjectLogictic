import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope, AuthPayload } from '../types/auth';
import { getAccessToken, getAuthSession, updateAuthSession } from './auth-session';
import { API_BASE_URL } from './runtime-config';

export const authApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10_000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

export const api = axios.create({
  baseURL: API_BASE_URL,
  // Operational transactions may run for up to 20 seconds on the backend.
  // Keep the browser timeout above that boundary so a committed mutation is
  // not reported as failed while its transaction is still completing.
  timeout: 30_000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

interface RetryableRequest extends InternalAxiosRequestConfig {
  _authRetry?: boolean;
}

let refreshPromise: Promise<AuthPayload> | null = null;

export async function refreshAuthSession(): Promise<AuthPayload> {
  const previousToken = getAccessToken();
  const rotate = () =>
    authApi.post<ApiEnvelope<AuthPayload>>('/auth/refresh').then((response) => {
      updateAuthSession(response.data.data);
      return response.data.data;
    });
  refreshPromise ??= (
    navigator.locks
      ? navigator.locks.request('logistics-auth-refresh', async () => {
          const session = getAuthSession();
          if (session && session.accessToken !== previousToken) return session;
          return rotate();
        })
      : rotate()
  ).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetryableRequest | undefined;

    if (error.response?.status !== 401 || !request || request._authRetry) {
      return Promise.reject(error);
    }

    request._authRetry = true;
    let session: AuthPayload;
    try {
      const current = getAuthSession();
      session =
        current && request.headers.get('Authorization') !== `Bearer ${current.accessToken}`
          ? current
          : await refreshAuthSession();
    } catch (refreshError) {
      updateAuthSession(null);
      return Promise.reject(refreshError);
    }
    request.headers.set('Authorization', `Bearer ${session.accessToken}`);
    return api.request(request);
  },
);
