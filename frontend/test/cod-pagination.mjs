import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Production COD page; HTTP interception is confined to this browser fixture.
const config = {
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/cod-pagination', rolldownOptions: { input: fileURLToPath(new URL('./address-location/index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4197, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let rows, posted = [], requests = [], failNext = false;
  const reset = () => {
    rows = Array.from({ length: 105 }, (_, index) => ({
      id: `cod-${index + 1}`, shipmentId: `shipment-${index + 1}`, expectedAmount: 150000,
      collectedAmount: 150000, remittedAmount: null, status: 'COLLECTED', remittances: [], payout: null,
      shipment: { trackingCode: `SHP-F05-${String(index + 1).padStart(3, '0')}`, customer: { fullName: 'COD Customer' } },
      collectedByDriver: { user: { fullName: 'COD Driver' } },
    }));
    rows[0].status = 'REMITTED';
    for (const [index, status] of ['PENDING', 'SENT', 'PAID_OUT', 'DISPUTED', null].entries()) {
      rows[index + 1].status = 'SETTLED';
      if (status) rows[index + 1].payout = { id: `payout-${index}`, status, method: 'BANK_TRANSFER', reference: 'F05-TEST' };
    }
    posted = []; requests = [];
  };
  const summary = () => ['COLLECTED', 'REMITTED', 'SETTLED'].map((status) => ({
    status, _sum: { expectedAmount: rows.filter((row) => row.status === status).length * 150000 },
    _count: { _all: rows.filter((row) => row.status === status).length },
  }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data;
    if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0 };
    else if (request.method() === 'GET' && /\/cod\/(mine|dashboard)$/.test(path)) {
      requests.push(Object.fromEntries(url.searchParams));
      if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { message: 'F05 thử lại danh sách' } }); return; }
      const current = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      assert.equal(limit, 20); assert.ok(current >= 1);
      const status = url.searchParams.get('status');
      const payout = url.searchParams.get('payoutStatus');
      if (path.endsWith('/mine')) assert.equal(payout, null);
      const filtered = rows.filter((row) => (!status || row.status === status) &&
        (!payout || (payout === 'NONE' ? !row.payout : row.payout?.status === payout)));
      data = { items: filtered.slice((current - 1) * limit, current * limit), page: current, limit,
        total: filtered.length, totalPages: Math.ceil(filtered.length / limit), summary: summary() };
    } else if (request.method() === 'POST' && path.endsWith('/remit')) {
      const row = rows.find((row) => path.includes(`/shipments/${row.shipmentId}/`));
      assert.ok(row);
      const body = request.postDataJSON();
      assert.equal(body.amount, row.expectedAmount);
      assert.match(body.clientRequestId, /^[a-f0-9-]{36}$/);
      posted.push(row.id);
      data = { id: 'f05-handover', status: 'PENDING', version: 0, amount: row.expectedAmount, submittedAt: '2026-10-07T00:00:00Z' };
      row.remittances = [data];
    } else throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
    await route.fulfill({ json: { data, meta: {} } });
  });
  const open = async (role) => {
    await page.goto(`http://127.0.0.1:4197/test/address-location/index.html?screen=/${role}/cod`);
    await expect(page.getByRole('table')).toBeVisible();
  };
  const nav = () => page.getByRole('navigation', { name: 'Phân trang COD', exact: true });
  const summaryText = () => page.getByRole('region', { name: 'Tổng hợp COD' }).innerText();
  const codes = () => page.getByRole('table').locator('tbody tr .font-mono').allTextContents();
  for (const size of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); reset();
    await open('driver');
    const totals = await summaryText();
    const first = await codes();
    for (let current = 2; current <= 6; current++) {
      await nav().getByRole('button', { name: 'Sau', exact: true }).click();
      await expect(nav()).toContainText(`Trang ${current} / 6`);
      if (current === 2) assert.equal((await codes()).filter((code) => first.includes(code)).length, 0);
      assert.equal(await summaryText(), totals);
    }
    await expect(page.getByText('SHP-F05-105', { exact: true })).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'SHP-F05-105' }).getByRole('button', { name: /Bàn giao COD/ }).click();
    await expect(page.getByRole('dialog')).toContainText('SHP-F05-105');
    await page.getByRole('dialog').getByRole('button', { name: 'Gửi yêu cầu bàn giao', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    assert.deepEqual(posted, ['cod-105']);
    await page.getByLabel('Trạng thái COD', { exact: true }).selectOption('COLLECTED');
    await expect(nav()).toContainText('Trang 1 / 5');
    assert.equal(requests.at(-1).page, '1');
    assert.equal(await summaryText(), totals);
    await expect(page.getByLabel('Chi trả khách hàng', { exact: true })).toHaveCount(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await open('admin');
    await page.getByLabel('Trạng thái COD', { exact: true }).selectOption('SETTLED');
    for (const status of ['PENDING', 'SENT', 'PAID_OUT', 'DISPUTED', 'NONE']) {
      await page.getByLabel('Chi trả khách hàng', { exact: true }).selectOption(status);
      await expect(page.getByText('1 giao dịch phù hợp · 1 giao dịch trên trang này.', { exact: true })).toBeVisible();
      assert.equal(requests.at(-1).payoutStatus, status);
      assert.equal(await summaryText(), totals);
    }
    await page.getByLabel('Chi trả khách hàng', { exact: true }).selectOption('SENT');
    await page.getByLabel('Trạng thái COD', { exact: true }).selectOption('COLLECTED');
    await expect(page.getByText('Không có giao dịch COD phù hợp', { exact: true })).toBeVisible();
    assert.equal(await summaryText(), totals);
    await page.getByLabel('Chi trả khách hàng', { exact: true }).selectOption('');
    await page.getByLabel('Trạng thái COD', { exact: true }).selectOption('');
    await expect(nav()).toContainText('Trang 1 / 6');
    failNext = true;
    await nav().getByRole('button', { name: 'Sau', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await expect(nav()).toContainText('Trang 2 / 6');
    // Another operator can complete/remove rows from the current filter while this page is open.
    rows = rows.slice(0, 5);
    await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await page.getByRole('button', { name: 'Về trang đầu', exact: true }).click();
    await expect(page.getByText('5 giao dịch phù hợp · 5 giao dịch trên trang này.', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS F05 ${size.width}: page 1/2/6, record 105 action, filters, global summary, empty/error/retry, stale page recovery, no horizontal viewport overflow`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
