import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const config = {
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/cod-ux', rolldownOptions: { input: fileURLToPath(new URL('./address-location/index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4196, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let status = 'COLLECTED';
  let posts = 0;
  let fail = false;
  const cod = () => ({ id: 'cod-1', shipmentId: 'cod', expectedAmount: 275000, collectedAmount: 275000,
    remittedAmount: status === 'COLLECTED' ? null : 275000, status });
  const address = { contactName: 'Test Receiver', phone: '0901234567', streetAddress: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành', district: '' };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data;
    if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0 };
    else if (path.includes('/shipping-fee-payments/')) data = { availableActions: { createPayment: false }, payment: null };
    else if (path.endsWith('/cod/mine') || path.endsWith('/cod/dashboard')) data = {
      items: [{ ...cod(), shipment: { trackingCode: 'SHP-COD-TEST' }, collectedByDriver: { user: { fullName: 'COD Driver' } } }], summary: [],
    };
    else if (path.endsWith('/remit') || path.endsWith('/settle')) {
      posts++;
      if (fail) { await route.fulfill({ status: 409, json: { message: 'COD không khớp' } }); return; }
      if (path.endsWith('/remit')) {
        assert.deepEqual(request.postDataJSON(), { amount: 275000 });
        assert.equal(status, 'COLLECTED'); status = 'REMITTED';
      } else { assert.equal(status, 'REMITTED'); status = 'SETTLED'; }
      data = cod(); // Actual command response deliberately has no shipment relation.
    } else if (path.endsWith('/dashboards/customer')) data = { overview: {
      totalShipments: 1, pending: 0, inTransit: 0, outForDelivery: 0, delivered: 1, failed: 0, cancelled: 0,
      deliverySuccessRate: 100, averageDeliveryTimeHours: 2, codCollected: 275000, codUnsettled: status === 'SETTLED' ? 0 : 275000,
    }, recentShipments: [] };
    else if (path.endsWith('/shipments/cod')) data = {
      id: 'cod', trackingCode: 'SHP-COD-TEST', status: 'DELIVERED', codStatus: status, codAmount: 275000, totalFee: 30000,
      sender: { fullName: 'Sender', phone: '0901234567' }, receiver: { fullName: 'Receiver', phone: '0901234567' },
      pickup: address, delivery: address, package: { description: 'COD parcel', packageType: 'PARCEL', weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 },
      pricing: { baseFee: 30000, distanceFee: 0, weightFee: 0, codFee: 0, surcharge: 0, discount: 0, totalFee: 30000 },
      shippingFeePayer: 'SENDER', shippingFee: { id: 'fee', payer: 'SENDER', status: 'COLLECTED', expectedAmount: 30000, collectedAmount: 30000 },
      canCancel: false, timeline: [], createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z',
    };
    else throw new Error(`Unexpected request ${path}`);
    await route.fulfill({ json: { data, meta: {} } });
  });
  const open = (screen) => page.goto(`http://127.0.0.1:4196/test/address-location/index.html?screen=${encodeURIComponent(screen === '/shipments/cod' ? '/cod-shipments/cod' : screen)}`);
  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    status = 'COLLECTED';
    await open('/shipments/cod');
    await expect(page.getByText('Đã thu COD', { exact: true })).toBeVisible();
    await open('/driver/cod');
    const before = posts;
    await page.getByRole('button', { name: 'Bàn giao COD', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    assert.equal(posts, before);
    await page.getByRole('button', { name: 'Xác nhận bàn giao', exact: true }).click();
    await expect(page.getByText('Đã bàn giao COD cho vận đơn SHP-COD-TEST.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bàn giao COD', exact: true })).toHaveCount(0);
    assert.equal(posts, before + 1);
    await open('/customer/dashboard');
    await expect(page.getByText('COD chưa quyết toán: tiền đã thu nhưng chưa hoàn tất bàn giao/đối soát.', { exact: true })).toBeVisible();
    const metric = page.locator('article').filter({ hasText: 'COD chưa quyết toán' });
    await expect(metric).toContainText('275.000');
    await open('/shipments/cod');
    await expect(page.getByText('Đã bàn giao COD', { exact: true })).toBeVisible();
    await open('/admin/cod');
    await page.getByRole('button', { name: 'Quyết toán', exact: true }).click();
    fail = true;
    await page.getByRole('button', { name: 'Xác nhận quyết toán', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Xác nhận quyết toán', exact: true }).click();
    await expect(page.getByText('Đã quyết toán COD cho vận đơn SHP-COD-TEST.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quyết toán', exact: true })).toHaveCount(0);
    await open('/customer/dashboard');
    await expect(metric).toContainText('0');
    await expect(metric).not.toContainText('275.000');
    await open('/shipments/cod');
    await expect(page.getByText('Đã quyết toán COD', { exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS COD ${size.width}x${size.height}: Driver confirm/remit, Admin error/retry/settle, actual response shape, Customer totals/detail, separate shipping fee`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
