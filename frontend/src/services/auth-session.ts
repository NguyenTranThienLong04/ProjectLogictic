import type { AuthPayload } from '../types/auth';

type SessionListener = (session: AuthPayload | null) => void;

let currentSession: AuthPayload | null = null;
let revision = 0;
const listeners = new Set<SessionListener>();
// Refresh cookies are shared by tabs; rotated access tokens must follow the same session.
// BroadcastChannel is transient, so tokens remain absent from persistent browser storage.
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('logistics-auth-session')
    : null;
if (channel) {
  channel.onmessage = (event: MessageEvent<AuthPayload | null>) => {
    currentSession = event.data;
    revision++;
    listeners.forEach((listener) => listener(currentSession));
  };
}

export function getAccessToken(): string | null {
  return currentSession?.accessToken ?? null;
}

export function getAuthSession(): AuthPayload | null {
  return currentSession;
}

export function getAuthRevision(): number {
  return revision;
}

export function updateAuthSession(
  session: AuthPayload | null,
  { broadcast = true }: { broadcast?: boolean } = {},
): void {
  currentSession = session;
  revision++;
  listeners.forEach((listener) => listener(session));
  // Only explicit logout propagates a null session. One failed refresh is local.
  if (broadcast) channel?.postMessage(session);
}

export function subscribeToAuthSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
