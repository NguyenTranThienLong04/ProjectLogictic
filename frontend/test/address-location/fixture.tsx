// Browser integration fixture: production pages; API interception lives only in check.mjs.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '../../src/features/auth/auth-context';
import { AddressesPage } from '../../src/features/addresses/addresses-page';
import { CreateShipmentPage } from '../../src/features/shipments/create-shipment-page';
import { QuotePage } from '../../src/features/pricing/quote-page';
import { PricingConfigPage } from '../../src/features/pricing/pricing-config-page';
import { AdminWarehousesPage } from '../../src/features/warehouses/pages/admin-warehouses-page';
import { AdminDriversPage } from '../../src/features/operations/admin-drivers-page';
import '../../src/styles.css';

const unavailable = async () => { throw new Error('Auth actions are outside this fixture'); };
const auth: AuthContextValue = {
  status: 'authenticated',
  user: { id: 'test-customer', role: 'CUSTOMER', status: 'ACTIVE', email: 'fixture@example.test',
    fullName: 'Test Customer', phone: '0901234567', mustChangePassword: false, createdAt: '', updatedAt: '' },
  login: unavailable, register: unavailable, logout: unavailable, updateUser: () => { throw new Error('Unexpected user update'); },
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const page = new URLSearchParams(location.search).get('screen') ?? '/addresses';
if (page.startsWith('/admin/') && auth.user) auth.user.role = 'ADMIN';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={[page]}>
    <Routes>
      <Route path="/admin/pricing" element={<PricingConfigPage />} />
      <Route path="/admin/drivers" element={<AdminDriversPage />} />
      <Route path="/admin/warehouses" element={<AdminWarehousesPage />} />
      <Route path="/addresses" element={<AddressesPage />} />
      <Route path="/shipments/new" element={<CreateShipmentPage />} />
      <Route path="/quote" element={<QuotePage />} />
      <Route path="/shipments/:id" element={<p>Shipment submitted</p>} />
    </Routes>
  </MemoryRouter></AuthContext.Provider></QueryClientProvider>,
);
