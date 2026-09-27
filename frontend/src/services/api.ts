import axios, { AxiosError } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope, AuthPayload } from '../types/auth';
import { getAccessToken, getAuthRevision, getAuthSession, updateAuthSession } from './auth-session';
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
let logoutPromise: Promise<void> | null = null;

export function isInvalidRefresh(error: unknown): boolean {
  return (
    axios.isAxiosError<{ code?: string }>(error) &&
    error.response?.status === 401 &&
    error.response.data?.code === 'AUTH_REFRESH_TOKEN_INVALID'
  );
}

export class AuthSessionChangedError extends Error {
  constructor() {
    super('Session changed while restoring authentication');
  }
}

function withAuthLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('logistics-auth-refresh', action) : action();
}

export async function refreshAuthSession(): Promise<AuthPayload> {
  if (logoutPromise) {
    await logoutPromise;
    throw new AuthSessionChangedError();
  }
  if (refreshPromise) return refreshPromise;
  const startedAt = getAuthRevision();
  const changedSession = (): AuthPayload => {
    const session = getAuthSession();
    if (session) return session;
    throw new AuthSessionChangedError();
  };
  refreshPromise = withAuthLock(async () => {
    // A queued tab can reuse a rotation received through BroadcastChannel.
    if (getAuthRevision() !== startedAt) return changedSession();
    try {
      const requestRefresh = () => authApi.post<ApiEnvelope<AuthPayload>>('/auth/refresh');
      let response: AxiosResponse<ApiEnvelope<AuthPayload>>;
      try {
        response = await requestRefresh();
      } catch (error) {
        if (navigator.locks || !isInvalidRefresh(error)) throw error;
        // Without Web Locks, a sibling may have consumed the shared cookie.
        // Allow its broadcast to arrive, then retry the current cookie once.
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (getAuthRevision() !== startedAt) return changedSession();
        response = await requestRefresh();
      }
      // A late response must not undo logout, login or a newer cross-tab session.
      if (getAuthRevision() !== startedAt) return changedSession();
      updateAuthSession(response.data.data);
      return response.data.data;
    } catch (error) {
      if (getAuthRevision() !== startedAt) return changedSession();
      if (isInvalidRefresh(error)) updateAuthSession(null, { broadcast: false });
      throw error;
    }
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function logoutAuthSession(): Promise<void> {
  if (logoutPromise) return logoutPromise;
  // Do not report guest before the cookie is revoked: a reload in that gap
  // could restore it. Serialize logout after any already-started rotation.
  logoutPromise = (async () => {
    await refreshPromise?.catch(() => undefined);
    await withAuthLock(async () => {
      await authApi.post('/auth/logout');
      updateAuthSession(null);
    });
  })().finally(() => {
    logoutPromise = null;
  });
  return logoutPromise;
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
      return Promise.reject(refreshError);
    }
    request.headers.set('Authorization', `Bearer ${session.accessToken}`);
    return api.request(request);
  },
);
