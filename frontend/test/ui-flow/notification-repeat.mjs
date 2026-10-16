import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = 'test-results/notification-repeat';
const config = {
  root, configFile: `${root}/vite.config.ts`, logLevel: 'error',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/notification-repeat' },
  preview: { host: '127.0.0.1', port: 4201, strictPort: true },
};
const origin = 'http://127.0.0.1:4201';
const withMap = !process.argv.includes('--without-map');
const channel = process.argv.includes('--chrome') ? 'chrome' : undefined;
const uuid = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
const contact = { contactName: 'Customer fixture', phone: '0901234567', streetAddress: '123 Test', ward: 'Test', district: '', city: 'Test' };
const detail = (id, withMap) => ({
  id, trackingCode: `SHP-${id.slice(-4)}`, status: withMap ? 'OUT_FOR_DELIVERY' : 'DELIVERED', createdAt: now, updatedAt: now,
  pickup: contact, delivery: contact, codAmount: 0, canCancel: false, timeline: [],
  package: { description: 'Customer parcel', packageType: 'PARCEL', weightGrams: 1000, lengthCm: 20, widthCm: 15, heightCm: 10 },
  pricing: { baseFee: 30000, distanceFee: 0, weightFee: 0, codFee: 0, surcharge: 0, discount: 0, totalFee: 30000 },
  shippingFee: { id: uuid(50), status: 'COLLECTED', payer: 'SENDER', expectedAmount: 30000, collectedAmount: 30000 },
});
await mkdir(directory, { recursive: true });
await build(config);
const server = await preview(config);
const results = [];
let browser;
try {
  browser = await chromium.launch({ channel });
  for (const width of [1440, 375]) {
    for (const mode of ['success', 'delay', 'failure']) {
      for (const entry of ['dropdown', 'center']) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage();
        const row = { width, mode, entry, withMap, channel: channel ?? 'chromium', clicks: [], detailReads: [], readRequests: [], errors: [], unexpected: [] };
        results.push(row);
        let refreshes = 0;
        const notifications = [
          { id: uuid(101), title: 'Notification A', type: 'SHIPMENT_CREATED', data: { shipmentId: uuid(11) } },
          { id: uuid(102), title: 'Notification B', type: 'SHIPMENT_PICKED_UP', data: { shipmentId: uuid(12), assignmentId: uuid(22) } },
          { id: uuid(103), title: 'Notification C', type: 'DELIVERED', data: { shipmentId: uuid(13) } },
          { id: uuid(104), title: 'Notification D same shipment', type: 'WAREHOUSE_ARRIVED', data: { shipmentId: uuid(13) }, readAt: now },
        ].map((item) => ({ readAt: null, ...item, eventKey: item.id, message: 'Shipment update', createdAt: now }));
        page.on('pageerror', (error) => row.errors.push(error.message));
        await page.route('**/socket.io/**', (route) => route.abort());
        await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
        await page.route('**/api/v1/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          let data;
          if (path.endsWith('/auth/refresh')) {
            refreshes++;
            data = { accessToken: 'local-http-fixture-token', expiresIn: 900, user: { id: uuid(1), role: 'CUSTOMER', status: 'ACTIVE', fullName: 'Customer fixture', email: 'customer@example.test', mustChangePassword: false } };
          } else if (path.endsWith('/notifications')) data = { items: notifications, page: 1, limit: 12, total: notifications.length, totalPages: 1, unreadCount: notifications.filter((item) => !item.readAt).length };
          else if (path.endsWith('/read')) {
            const item = notifications.find((item) => path.includes(item.id));
            const read = { id: item.id, started: Date.now() };
            row.readRequests.push(read);
            if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 2000));
            read.finished = Date.now();
            if (mode === 'failure') return route.fulfill({ status: 503, json: { message: 'Read temporarily unavailable' } });
            item.readAt = now; data = item;
          } else if (path.startsWith('/api/v1/shipping-fee-payments/shipments/')) data = { availableActions: { createPayment: false }, unavailableReason: null, payment: null };
          else if (path === '/api/v1/shipments') data = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };
          else if (path.endsWith('/location')) data = { driverId: uuid(22), latitude: 10.776, longitude: 106.7, capturedAt: now };
          else if (path.startsWith('/api/v1/shipments/')) {
            row.detailReads.push(path);
            data = detail(path.split('/').at(-1), withMap);
          } else { row.unexpected.push(path); return route.abort(); }
          await route.fulfill({ json: { data, meta: {} } });
        });
        const bell = page.locator('summary').filter({ hasText: 'Thông báo' });
        try {
          await page.goto(origin + (entry === 'dropdown' ? '/shipments' : '/notifications'));
          await expect(bell).toBeVisible();
          const timeOrigin = await page.evaluate(() => performance.timeOrigin);
          // No goto/reload between clicks: revisit fresh and cached details, including the same ID.
          for (const [step, index] of [0, 1, 2, 3, 0, 1].entries()) {
            const notification = notifications[index];
            if (entry === 'center' && step > 0) await page.goBack();
            if (entry === 'dropdown') await bell.click();
            if (mode === 'delay' && step === 1) assert(row.readRequests.some((read) => !read.finished), 'second click must occur while first PATCH is still pending');
            if (entry === 'dropdown' && step === 3) await bell.evaluate((element) => { element.dataset.repeatInstance = 'cached-detail'; });
            const button = page.getByRole('button', { name: new RegExp(`^${notification.title}`) });
            await expect(button).toBeVisible();
            const hit = await button.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { disabled: element.disabled, hit: target?.outerHTML.slice(0, 250), receivesPointer: element.contains(target), open: element.closest('details')?.open };
            });
            const click = { title: notification.title, from: new URL(page.url()).pathname, hit };
            row.clicks.push(click);
            const started = Date.now();
            const historyBefore = await page.evaluate(() => history.state.key);
            await button.click({ timeout: 3000 });
            await expect(page).toHaveURL(`${origin}/shipments/${notification.data.shipmentId}`, { timeout: 1000 });
            await expect.poll(() => page.evaluate(() => history.state.key)).not.toBe(historyBefore);
            click.navigationMs = Date.now() - started;
            assert(click.navigationMs < 1800, 'navigation must not wait for the 2s read request');
            await expect(page.getByRole('heading', { name: detail(notification.data.shipmentId).trackingCode, exact: true })).toBeVisible();
            if (withMap) await expect(page.getByRole('region', { name: 'Bản đồ vị trí tài xế' })).toBeVisible();
            if (entry === 'dropdown' && step >= 3) await expect(bell).toHaveAttribute('data-repeat-instance', 'cached-detail');
            await expect(page.locator('details[open]').filter({ has: bell })).toHaveCount(0);
            assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'each click must stay in the same document');
          }
          assert.equal(refreshes, 1, 'sequence must not need auth reload or document navigation');
          for (const id of [11, 12, 13]) assert(row.detailReads.includes(`/api/v1/shipments/${uuid(id)}`));
          assert(!row.readRequests.some((read) => read.id === uuid(104)), 'read notification must not PATCH');
          await expect.poll(() => row.readRequests.every((read) => read.finished)).toBe(true);
          await page.reload();
          await expect(page.getByRole('heading', { name: detail(uuid(12)).trackingCode, exact: true })).toBeVisible();
          await expect(page).toHaveURL(`${origin}/shipments/${uuid(12)}`);
          assert.equal(refreshes, 2);
          assert.deepEqual(row.errors, []); assert.deepEqual(row.unexpected, []);
          row.result = 'PASS';
          console.log(`PASS repeated Customer ${width}px ${entry} ${mode}: A → B → C → same C → A → B + F5`);
        } catch (error) {
          row.result = 'FAIL'; row.error = error.message;
          await page.screenshot({ path: `${directory}/failure-${width}-${entry}-${mode}.png` });
          throw error;
        } finally {
          await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
          await context.close();
        }
      }
    }
  }
} finally { await browser?.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
