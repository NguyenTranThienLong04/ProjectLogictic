import { useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { refreshAuthSession } from '../../services/api';
import {
  getAuthSession,
  subscribeToAuthSession,
  updateAuthSession,
} from '../../services/auth-session';
import type { AuthPayload } from '../../types/auth';
import * as authRequests from './auth-api';
import { AuthContext } from './auth-context';
import type { AuthContextValue, AuthStatus } from './auth-context';

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthPayload | null>(() => getAuthSession());
  const [ready, setReady] = useState(false);
  const status: AuthStatus = !ready ? 'loading' : session ? 'authenticated' : 'guest';

  useEffect(() => subscribeToAuthSession(setSession), []);

  useEffect(() => {
    let active = true;

    refreshAuthSession()
      .catch(() => updateAuthSession(null))
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      login: async (input) => {
        const nextSession = await authRequests.login(input);
        updateAuthSession(nextSession);
        return nextSession;
      },
      register: async (input) => {
        const nextSession = await authRequests.register(input);
        updateAuthSession(nextSession);
        return nextSession;
      },
      logout: async () => {
        try {
          await authRequests.logout();
        } finally {
          updateAuthSession(null);
        }
      },
      updateUser: (user) => {
        const currentSession = getAuthSession();
        if (currentSession) updateAuthSession({ ...currentSession, user });
      },
    }),
    [session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
