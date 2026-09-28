// Real backend projection + real public page, with local HTTP transport fixtures.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { mapPublicTimeline } from '../../../backend/dist/modules/shipments/shipment.response.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {
  logLevel: 'error', root, configFile: `${root}/vite.config.ts`,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/p0-tracking', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4197, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const timeline = ['WAREHOUSE_TRANSFER_DISPATCHED', 'WAREHOUSE_TRANSFER_RECEIVED'].map((type, index) => mapPublicTimeline({
    id: `event-${index}`, type, status: index ? 'AT_DESTINATION_WAREHOUSE' : 'IN_TRANSIT',
    title: index ? 'Đã nhập kho đích' : 'Đang trung chuyển liên kho',
    description: 'Lifecycle. Ghi chú: PRIVATE-P0-NOTE', createdAt: new Date('2026-09-28T12:00:00Z'),
  }));
  assert(!JSON.stringify(timeline).includes('PRIVATE-P0-NOTE'));
  await page.route('**/api/v1/tracking/*', (route) => route.fulfill({ json: { data: {
    trackingCode: 'SHP-P0-TRACKING', status: 'AT_DESTINATION_WAREHOUSE',
    originCity: 'Đà Nẵng', destinationCity: 'Hồ Chí Minh', createdAt: '2026-09-28T12:00:00Z', timeline,
  }, meta: {} } }));
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:4197/test/address-location/index.html?screen=/tracking');
    await page.getByLabel('Mã vận đơn', { exact: true }).fill('SHP-P0-TRACKING');
    await page.getByRole('button', { name: 'Tra cứu', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Dòng thời gian vận đơn' }).locator('li')).toHaveCount(2);
    await expect(page.getByText('Kiện hàng đang được trung chuyển liên kho.', { exact: true })).toBeVisible();
    await expect(page.getByText('Kiện hàng đã được tiếp nhận tại kho đích.', { exact: true })).toBeVisible();
    assert(!(await page.locator('body').innerText()).includes('PRIVATE-P0-NOTE'));
    console.log(`PASS public tracking backend projection/render ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
