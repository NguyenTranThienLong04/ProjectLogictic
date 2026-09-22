import type { QueryClient } from '@tanstack/react-query';
import type { AuthPayload } from '../types/auth';
import { getAuthSession, subscribeToAuthSession } from './auth-session.ts';

export function subscribeWithAuthQueryCache(
  queryClient: QueryClient,
  onSession: (session: AuthPayload | null) => void,
) {
  const identity = (session: AuthPayload | null) =>
    session ? `${session.user.id}:${session.user.role}` : null;
  let currentIdentity = identity(getAuthSession());

  return subscribeToAuthSession((session) => {
    const nextIdentity = identity(session);
    if (currentIdentity !== nextIdentity) {
      // Clear cancels outstanding queries as well as removing cached data/mutations.
      // Do this before publishing the new identity to React, including cross-tab changes.
      queryClient.clear();
      currentIdentity = nextIdentity;
    }
    onSession(session);
  });
}
