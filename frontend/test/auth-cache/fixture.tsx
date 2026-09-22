import { useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '../../src/app/providers';
import { AuthContext } from '../../src/features/auth/auth-context';
import { WarehouseWorkspacePage } from '../../src/features/warehouses/pages/warehouse-workspace-page';
import '../../src/styles.css';

export function Fixture() {
  const auth = useContext(AuthContext)!;
  if (auth.status === 'loading') return <p>Loading session</p>;
  if (auth.user) return <WarehouseWorkspacePage />;
  return (
    <>
      {['origin', 'destination'].map((actor) => (
        <button
          key={actor}
          onClick={() =>
            void auth.login({ email: `${actor}@example.test`, password: 'Fixture-only' })
          }
        >
          Login {actor}
        </button>
      ))}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <Fixture />
  </AppProviders>,
);
