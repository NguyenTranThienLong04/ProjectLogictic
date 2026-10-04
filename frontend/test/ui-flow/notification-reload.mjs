import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Actual App, BrowserRouter, AuthProvider and lazy Driver routes; HTTP is mocked.
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {
  root, configFile: `${root}/vite.config.ts`, logLevel: 'error',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/notification-reload' },
  preview: { host: '127.0.0.1', port: 4199, strictPort: true },
};
await build(config);
const server = await preview(config);
const origin = 'http://127.0.0.1:4199';
const uuid = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
const contact = { fullName: 'Driver fixture', contactName: 'Driver fixture', phone: '0901234567', streetAddress: '123 Test', ward: 'Test', district: '', city: 'Test' };
let browser;
try {
  await mkdir('test-results/notification-linehaul', { recursive: true });
  browser = await chromium.launch();
  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [], detailReads = [], unexpected = [];
    let refreshes = 0;
    const notifications = [
      { id: uuid(11), type: 'PICKUP_ASSIGNMENT_CREATED', title: 'Pickup notification', data: { assignmentId: uuid(21), shipmentId: uuid(31) } },
      { id: uuid(12), type: 'DELIVERY_ASSIGNMENT_CREATED', title: 'Delivery notification', data: { assignmentId: uuid(22), shipmentId: uuid(32) } },
    ].map((item) => ({ ...item, eventKey: item.id, message: 'Mở nhiệm vụ', readAt: null, createdAt: now }));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/socket.io/**', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data;
      if (path.endsWith('/auth/refresh')) {
        refreshes++;
        data = { accessToken: 'local-http-fixture-token', expiresIn: 900, user: { id: uuid(1), role: 'DRIVER', status: 'ACTIVE', fullName: 'Driver fixture', email: 'driver@example.test', mustChangePassword: false } };
      } else if (path.endsWith('/notifications')) data = { items: notifications, page: 1, limit: 12, total: 2, totalPages: 1, unreadCount: notifications.filter((item) => !item.readAt).length };
      else if (path.endsWith('/read')) { data = notifications.find((item) => path.includes(item.id)); data.readAt = now; }
      else if (path.endsWith('/drivers/me')) data = { id: uuid(2), isOnline: false, status: 'AVAILABLE', capabilities: ['PICKUP', 'DELIVERY'] };
      else if (path.endsWith('/active-trip') || path.endsWith('/driver/location')) data = null;
      else if (/\/driver\/(?:assignments|delivery-assignments)$/.test(path)) data = { items: [], pagination: { page: 1, total: 0, totalPages: 1 } };
      else if (/\/driver\/(?:assignments|delivery-assignments)\//.test(path)) {
        detailReads.push(path);
        assert([uuid(21), uuid(22)].includes(path.split('/').at(-1)), 'must use assignment ID, never shipment ID');
        data = { id: path.split('/').at(-1), status: 'COMPLETED', shipmentStatus: 'DELIVERED', trackingCode: path.endsWith(uuid(21)) ? 'SHP-PICKUP' : 'SHP-DELIVERY',
          pickup: contact, delivery: contact, receiver: contact, assignedAt: now, proofs: [], codAmount: 0,
          shippingFee: { status: 'COLLECTED', payer: 'SENDER', expectedAmount: 30000 },
          taskLocation: { kind: 'PICKUP', label: 'Test', address: '123 Test', latitude: null, longitude: null } };
      } else { unexpected.push(path); return route.abort(); }
      await route.fulfill({ json: { data, meta: {} } });
    });
    for (const entry of ['dropdown', 'center']) {
      for (const index of [0, 1]) {
        await page.goto(origin + (entry === 'dropdown' ? '/driver/assignments' : '/notifications'));
        if (entry === 'dropdown') await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
        await page.getByRole('button', { name: new RegExp(notifications[index].title) }).click();
        const target = index === 0 ? `/driver/pickups/${uuid(21)}` : `/driver/deliveries/${uuid(22)}`;
        const heading = index === 0 ? 'Chi tiết lấy hàng' : 'Chi tiết giao hàng';
        await expect(page).toHaveURL(origin + target);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        const readsBefore = detailReads.length, refreshesBefore = refreshes;
        await page.reload();
        await expect(page).toHaveURL(origin + target);
        await expect(page.getByText(index === 0 ? 'SHP-PICKUP' : 'SHP-DELIVERY', { exact: true })).toBeVisible();
        assert(detailReads.length > readsBefore && refreshes > refreshesBefore, 'F5 must restore auth and refetch owned detail from URL');
        await page.screenshot({ path: `test-results/notification-linehaul/${entry}-${index}-${width}.png` });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${width}px: actual App dropdown/center pickup/delivery → URL → F5 auth restore + correct detail refetch`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
