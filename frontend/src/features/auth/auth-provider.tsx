import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthSessionChangedError, isInvalidRefresh, refreshAuthSession } from '../../services/api';
import { subscribeWithAuthQueryCache } from '../../services/auth-query-cache';
import { getAuthSession, updateAuthSession } from '../../services/auth-session';
import type { AuthPayload } from '../../types/auth';
import * as authRequests from './auth-api';
import { AuthContext } from './auth-context';
import type { AuthContextValue, AuthStatus } from './auth-context';

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthPayload | null>(() => getAuthSession());
  const [restoreState, setRestoreState] = useState<'loading' | 'ready' | 'restore-error'>(
    'loading',
  );
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const status: AuthStatus = session
    ? 'authenticated'
    : restoreState === 'ready'
      ? 'guest'
      : restoreState;
  const retryRestore = useCallback(() => {
    setRestoreState('loading');
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(
    () =>
      subscribeWithAuthQueryCache(queryClient, (nextSession) => {
        setSession(nextSession);
        // A peer login/logout also resolves a previously failed restore attempt.
        setRestoreState('ready');
      }),
    [queryClient],
  );

  useEffect(() => {
    let active = true;

    refreshAuthSession()
      .then(() => {
        if (active) setRestoreState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRestoreState(
          isInvalidRefresh(error) || error instanceof AuthSessionChangedError
            ? 'ready'
            : 'restore-error',
        );
      });

    return () => {
      active = false;
    };
  }, [restoreAttempt]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      retryRestore,
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
      logout: authRequests.logout,
      updateUser: (user) => {
        const currentSession = getAuthSession();
        if (currentSession) updateAuthSession({ ...currentSession, user });
      },
    }),
    [session, status, retryRestore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
