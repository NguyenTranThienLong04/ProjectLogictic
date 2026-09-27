import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppProviders } from '../../src/app/providers';
import { GuestRoute, ProtectedRoute } from '../../src/app/route-guards';
import { useAuth } from '../../src/features/auth/auth-context';
import { LoginPage } from '../../src/features/auth/pages/login-page';
import { api } from '../../src/services/api';
import '../../src/styles.css';

export function Observe() {
  const { status, user } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('auth-test-state', {
        detail: { status, role: user?.role ?? null, pathname, time: performance.now() },
      }),
    );
  }, [status, user, pathname]);
  return <output data-testid="auth-status">{status}</output>;
}

export function Workspace() {
  const { user, logout, login } = useAuth();
  const [result, setResult] = useState('');
  return (
    <main>
      <h1>{user?.role} workspace</h1>
      <button onClick={() => void logout().catch(() => setResult('logout failed'))}>Logout</button>
      <button onClick={() => void login({ email: user!.email, password: 'Browser-fixture-only' })}>
        Sign in again
      </button>
      <button
        onClick={() =>
          void Promise.allSettled(Array.from({ length: 8 }, () => api.get('/test/protected'))).then(
            (results) =>
              setResult(
                results.every((r) => r.status === 'fulfilled')
                  ? 'requests passed'
                  : 'requests failed',
              ),
          )
        }
      >
        Load protected data
      </button>
      <output data-testid="api-result">{result}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <Observe />
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="*" element={<Workspace />} />
        </Route>
      </Routes>
    </AppProviders>
  </StrictMode>,
);
