import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Real AuthProvider + Warehouse page + QueryClient, intercepted API only.
const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: {
    outDir: '.vite/auth-cache',
    rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
  preview: { host: '127.0.0.1', port: 4193, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  let actor;
  const profileReads = [];
  const warehouse = (id) => ({
    id,
    code: `${id}-hub`,
    name: `${id} Warehouse`,
    address: 'Test address',
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (path.endsWith('/auth/login')) {
      actor = route.request().postDataJSON().email.split('@')[0];
      data = {
        accessToken: actor,
        expiresIn: 900,
        user: {
          id: actor,
          fullName: actor,
          email: `${actor}@example.test`,
          role: 'WAREHOUSE_STAFF',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      };
    } else if (path.endsWith('/auth/logout')) data = {};
    else if (path.endsWith('/warehouses/staff/me')) {
      const requestedActor = route.request().headers().authorization.replace('Bearer ', '');
      profileReads.push(requestedActor);
      await new Promise((resolve) => setTimeout(resolve, 200));
      data = {
        id: requestedActor,
        warehouseId: requestedActor,
        staffCode: requestedActor,
        isActive: true,
        user: { fullName: requestedActor },
        warehouse: warehouse(requestedActor),
      };
    } else if (path.endsWith('/warehouses'))
      data = {
        items: [warehouse('origin'), warehouse('destination')],
        pagination: { page: 1, total: 2, totalPages: 1 },
      };
    else if (path.endsWith('/inbound-queue'))
      data = { pickedUpShipments: [], incomingTransfers: [] };
    else if (path.endsWith('/shipments')) data = { items: [], pagination: { total: 0 } };
    else if (path.endsWith('/transfers')) data = [];
    else if (path.includes('/notifications'))
      data = { items: [], unreadCount: 0, pagination: { total: 0 } };
    else throw new Error(`Unexpected API: ${path}`);
    await route.fulfill({ json: { data, meta: {} } });
  });
  await page.goto('http://127.0.0.1:4193/test/auth-cache/index.html');
  await page.getByRole('button', { name: 'Login origin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'origin Warehouse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await page.getByRole('button', { name: 'Login destination', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'origin Warehouse', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'destination Warehouse', exact: true }),
  ).toBeVisible();
  assert.deepEqual(profileReads, ['origin', 'destination']);
  console.log(
    'PASS: same-tab Warehouse account switch refetches identity and never reuses the origin profile. API mocked; not staging evidence.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
