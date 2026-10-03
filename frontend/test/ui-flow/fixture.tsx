import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '../../src/features/auth/auth-context';
import { AccountLayout } from '../../src/features/auth/components/account-layout';
import { WarehouseWorkspacePage } from '../../src/features/warehouses/pages/warehouse-workspace-page';
import { NotificationsPage } from '../../src/features/notifications/notifications-page';
import { PickupDetailPage } from '../../src/features/operations/pickup-detail-page';
import { DeliveryDetailPage } from '../../src/features/operations/delivery-detail-page';
import '../../src/styles.css';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? '/warehouse/workspace';
const unavailable = async () => { throw new Error('Auth mutation outside fixture'); };
const auth: AuthContextValue = {
  status: 'authenticated', retryRestore: () => {},
  user: { id: 'fixture-user', role: screen.startsWith('/warehouse') ? 'WAREHOUSE_STAFF' : 'DRIVER',
    status: 'ACTIVE', email: 'fixture@example.test', fullName: 'UI Regression', phone: null,
    mustChangePassword: false, createdAt: '', updatedAt: '' },
  login: unavailable, register: unavailable, logout: unavailable, updateUser: () => {},
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function Location() { return <output data-testid="route">{useLocation().pathname}</output>; }
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={[screen]}>
    <Location />
    <Routes>
      <Route path="/warehouse/workspace" element={<WarehouseWorkspacePage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/driver/pickups/:assignmentId" element={<PickupDetailPage />} />
      <Route path="/driver/deliveries/:assignmentId" element={<DeliveryDetailPage />} />
      <Route path="*" element={<AccountLayout><h1>Danh sách nhiệm vụ</h1></AccountLayout>} />
    </Routes>
  </MemoryRouter></AuthContext.Provider></QueryClientProvider>,
);
