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
  let status, remittances, payout, posts = 0, fail = false;
  const now = '2026-09-27T00:00:00Z';
  const cod = () => ({ id: 'cod-1', shipmentId: 'cod', expectedAmount: 275000, collectedAmount: 275000,
    remittedAmount: status === 'COLLECTED' ? null : 275000, status, remittances, payout });
  const address = { contactName: 'Test Receiver', phone: '0901234567', streetAddress: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành', district: '' };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data;
    if (request.method() === 'POST') {
      posts++;
      if (fail) { await route.fulfill({ status: 409, json: { message: 'COD không khớp. Kiểm tra lại chứng từ.' } }); return; }
      const body = request.postDataJSON();
      if (path.endsWith('/remit')) {
        assert.equal(body.amount, 275000); assert.match(body.clientRequestId, /^[a-f0-9-]{36}$/);
        assert.equal(status, 'COLLECTED');
        data = { id: `handover-${remittances.length}`, status: 'PENDING', version: 0, amount: 275000, submittedAt: now, reviewedAt: null, rejectionReason: null };
        remittances.unshift(data);
      } else if (path.includes('/remittances/')) {
        assert.equal(status, 'COLLECTED'); assert.equal(body.expectedVersion, 0);
        const row = remittances[0]; row.version++; row.reviewedAt = now;
        if (path.endsWith('/reject')) { row.status = 'REJECTED'; row.rejectionReason = body.reason; }
        else { row.status = 'CONFIRMED'; status = 'REMITTED'; }
        data = row;
      } else if (path.endsWith('/settle')) { assert.equal(status, 'REMITTED'); status = 'SETTLED'; data = cod(); }
      else if (path.endsWith('/payout')) {
        assert.equal(status, 'SETTLED'); assert.equal(body.amount, 275000); assert(body.reference);
        payout = { id: 'payout-1', ...body, status: 'PENDING', version: 0, createdAt: now, sentAt: null, customerConfirmedAt: null, disputedAt: null, disputeReason: null };
        data = payout;
      } else if (path.endsWith('/send')) {
        assert.equal(payout.status, 'PENDING'); assert.equal(body.expectedVersion, 0); assert.equal(body.reference, payout.reference);
        payout.status = 'SENT'; payout.version = 1; payout.sentAt = now; data = payout;
      } else if (path.includes('/payouts/')) {
        assert.equal(payout.status, 'SENT'); assert.equal(body.expectedVersion, 1);
        payout.version = 2;
        if (path.endsWith('/dispute')) { payout.status = 'DISPUTED'; payout.disputedAt = now; payout.disputeReason = body.reason; }
        else { payout.status = 'PAID_OUT'; payout.customerConfirmedAt = now; }
        data = payout;
      } else throw new Error(`Unexpected POST ${path}`);
    } else if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0 };
    else if (path.includes('/shipping-fee-payments/')) data = { availableActions: { createPayment: false }, payment: null };
    else if (path.endsWith('/cod/mine') || path.endsWith('/cod/dashboard')) data = {
      items: [{ ...cod(), shipment: { trackingCode: 'SHP-COD-TEST', customer: { fullName: 'COD Customer' } }, collectedByDriver: { user: { fullName: 'COD Driver' } } }], summary: [], page: 1, limit: 20, total: 1, totalPages: 1,
    };
    else if (path.endsWith('/cod/shipments/cod')) data = { ...cod(), collectedAt: now, remittedAt: status === 'COLLECTED' ? null : now, settledAt: status === 'SETTLED' ? now : null };
    else if (path.endsWith('/dashboards/customer')) data = { overview: {
      totalShipments: 1, pending: 0, inTransit: 0, outForDelivery: 0, delivered: 1, failed: 0, cancelled: 0,
      deliverySuccessRate: 100, averageDeliveryTimeHours: 2, codCollected: 275000, codUnsettled: status === 'SETTLED' ? 0 : 275000,
      codAwaitingPayout: status === 'SETTLED' && payout?.status !== 'PAID_OUT' ? 275000 : 0, codPaidOut: payout?.status === 'PAID_OUT' ? 275000 : 0,
    }, recentShipments: [] };
    else if (path.endsWith('/shipments/cod')) data = {
      id: 'cod', trackingCode: 'SHP-COD-TEST', status: 'DELIVERED', codStatus: status, codAmount: 275000, totalFee: 30000,
      sender: { fullName: 'Sender', phone: '0901234567' }, receiver: { fullName: 'Receiver', phone: '0901234567' },
      pickup: address, delivery: address, package: { description: 'COD parcel', packageType: 'PARCEL', weightGrams: 500, lengthCm: 10, widthCm: 10, heightCm: 10 },
      pricing: { baseFee: 30000, distanceFee: 0, weightFee: 0, codFee: 0, surcharge: 0, discount: 0, totalFee: 30000 },
      shippingFeePayer: 'SENDER', shippingFee: { id: 'fee', payer: 'SENDER', status: 'COLLECTED', expectedAmount: 30000, collectedAmount: 30000 },
      canCancel: false, timeline: [], createdAt: now, updatedAt: now,
    };
    else throw new Error(`Unexpected request ${path}`);
    await route.fulfill({ json: { data, meta: {} } });
  });
  const open = async (screen) => {
    await page.goto(`http://127.0.0.1:4196/test/address-location/index.html?screen=${encodeURIComponent(screen === '/shipments/cod' ? '/cod-shipments/cod' : screen)}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  };
  const dialog = () => page.getByRole('dialog');
  const act = async (name, confirm = name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(dialog()).toBeVisible();
    await dialog().getByRole('button', { name: confirm, exact: true }).click();
    await expect(dialog()).not.toBeVisible();
  };
  const metric = (label) => page.locator('article').filter({ has: page.getByText(label, { exact: true }) });
  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    status = 'COLLECTED'; remittances = []; payout = null;
    await open('/driver/cod');
    const before = posts;
    await page.getByRole('button', { name: /Bàn giao COD 275/ }).click();
    await expect(dialog()).toBeVisible(); assert.equal(posts, before);
    fail = true;
    await dialog().getByRole('button', { name: 'Gửi yêu cầu bàn giao', exact: true }).click();
    await expect(dialog().getByRole('alert')).toBeVisible();
    assert.equal(remittances.length, 0); assert.equal(status, 'COLLECTED');
    fail = false;
    await dialog().getByRole('button', { name: 'Gửi yêu cầu bàn giao', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    await page.reload();
    await expect(page.getByText('Đang chờ công ty xác nhận đã nhận tiền', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bàn giao COD 275/ })).toHaveCount(0);
    assert.equal(status, 'COLLECTED');
    await open('/admin/cod');
    await page.getByRole('button', { name: 'Từ chối bàn giao', exact: true }).click();
    await dialog().getByLabel('Lý do từ chối').fill('Chưa nhận đủ tiền');
    await dialog().getByRole('button', { name: 'Từ chối bàn giao', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    await open('/driver/cod');
    await expect(page.getByText('Chưa nhận đủ tiền', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /Bàn giao COD 275/ }).click();
    await dialog().getByRole('button', { name: 'Gửi yêu cầu bàn giao', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    await open('/admin/cod');
    await act('Xác nhận đã nhận đủ');
    assert.equal(status, 'REMITTED');
    await act('Hoàn tất đối soát nội bộ');
    assert.equal(status, 'SETTLED');
    await open('/customer/dashboard');
    await expect(metric('COD chưa đối soát')).toContainText('0');
    await expect(metric('COD chờ chi trả')).toContainText('275.000');
    await expect(metric('COD đã chi trả')).not.toContainText('275.000');
    await open('/admin/cod');
    await page.getByRole('button', { name: 'Tạo khoản chi trả', exact: true }).click();
    await expect(dialog().getByRole('button', { name: 'Tạo khoản chi trả', exact: true })).toBeDisabled();
    await dialog().getByLabel('Mã giao dịch chuyển khoản').fill('BANK-TEST-001');
    await dialog().getByRole('button', { name: 'Tạo khoản chi trả', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    await act('Ghi nhận đã gửi tiền');
    assert.equal(payout.status, 'SENT');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await open('/shipments/cod');
    await expect(page.getByText('Đang chờ bạn xác nhận đã nhận tiền.', { exact: true })).toBeVisible();
    await expect(page.getByText('Công ty đã xác nhận nhận tiền', { exact: true })).toBeVisible();
    await act('Tôi đã nhận đủ tiền', 'Xác nhận đã nhận tiền');
    await page.reload();
    await expect(page.getByText('Khách đã xác nhận nhận tiền', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tôi đã nhận đủ tiền', exact: true })).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await open('/customer/dashboard');
    await expect(metric('COD chờ chi trả')).not.toContainText('275.000');
    await expect(metric('COD đã chi trả')).toContainText('275.000');
    // Independent fixture for the disputed branch, using the same production component.
    payout = { ...payout, status: 'SENT', version: 1, customerConfirmedAt: null };
    await open('/shipments/cod');
    await page.getByRole('button', { name: 'Tôi chưa nhận / Có vấn đề', exact: true }).click();
    await dialog().getByLabel('Vấn đề bạn gặp phải').fill('Tài khoản chưa nhận được tiền');
    await dialog().getByRole('button', { name: 'Gửi báo cáo', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    await page.reload();
    await expect(page.getByText('Khoản chi trả có vấn đề', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tôi đã nhận đủ tiền', exact: true })).toHaveCount(0);
    await open('/customer/dashboard');
    await expect(metric('COD chờ chi trả')).toContainText('275.000');
    await expect(metric('COD đã chi trả')).not.toContainText('275.000');
    console.log(`PASS COD ${size.width}x${size.height}: submit/error/retry/reject/resubmit/confirm/settle/create/send/receive/dispute/reload, no optimistic financial success, dashboard and responsive layout`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
