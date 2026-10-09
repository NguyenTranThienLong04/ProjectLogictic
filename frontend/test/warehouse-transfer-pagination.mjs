import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Reuse the real WarehouseWorkspacePage fixture. HTTP is intercepted; PostgreSQL is tested in F07 E2E.
const root = fileURLToPath(new URL('../', import.meta.url));
const config = { root, configFile: `${root}/vite.config.ts`, logLevel: 'error',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/transfer-pagination', rolldownOptions: { input: `${root}/test/ui-flow/index.html` } },
  preview: { host: '127.0.0.1', port: 4202, strictPort: true } };
await build(config);
const server = await preview(config);
let browser;
const uuid = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
const origin = { id: uuid(1), code: 'A', name: 'Kho A', address: 'Test', isActive: true };
const destination = { ...origin, id: uuid(2), code: 'B', name: 'Kho B' };
const paginate = (items, params) => {
  const page = Number(params.get('page') || 1), limit = Number(params.get('limit') || 20);
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, totalPages: Math.ceil(items.length / limit) };
};
try {
  await mkdir('test-results/transfer-pagination', { recursive: true });
  browser = await chromium.launch();
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], unexpected = [], reads = [], received = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let fail = false;
    let release;
    let gate;
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: uuid(1000 + index), shipmentId: uuid(2000 + index), transferCode: `TRF-${String(index + 1).padStart(3, '0')}`,
      fromWarehouseId: origin.id, toWarehouseId: destination.id, fromWarehouse: origin, toWarehouse: destination,
      status: 'IN_TRANSIT', createdAt: now, dispatchedAt: now,
      shipment: { trackingCode: `SHP-${String(index + 1).padStart(3, '0')}`, status: 'IN_TRANSIT' },
      workflow: { lineHaulRequired: true, canStandaloneDispatch: false, canReceive: true, legacyStandalone: true },
    }));
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url()), path = url.pathname, params = url.searchParams;
      let data;
      if (path.endsWith('/notifications')) data = { items: [], total: 0, totalPages: 0, unreadCount: 0 };
      else if (path.endsWith('/staff/me')) data = { warehouseId: destination.id, warehouse: destination, user: { fullName: 'F07 Staff' } };
      else if (path.endsWith('/warehouses')) data = { items: [origin, destination], pagination: { totalPages: 1 } };
      else if (path.endsWith('/inbound-queue')) data = { pickedUpShipments: [], incomingTransfers: paginate(rows.filter((row) => row.status === 'IN_TRANSIT'), params) };
      else if (path.endsWith('/shipments')) data = { items: [{
        id: uuid(3000), trackingCode: 'SHP-INVENTORY', status: 'AT_ORIGIN_WAREHOUSE', currentWarehouseId: destination.id,
        destinationWarehouseId: origin.id, destinationWarehouse: origin,
        activeTransfer: { id: uuid(3100), transferCode: 'TRF-ACTIVE-OUTSIDE-PAGE', status: 'PENDING' },
        packageSnapshot: {}, senderSnapshot: {}, receiverSnapshot: {}, deliverySnapshot: {},
      }], pagination: { total: 1, totalPages: 1 } };
      else if (path.endsWith('/transfers')) {
        reads.push({ path, params: Object.fromEntries(params) });
        if (gate) await gate;
        if (fail) return route.fulfill({ status: 503, json: { message: 'Không thể tải chuyển kho' } });
        const search = (params.get('search') || '').toLowerCase();
        data = paginate(rows.filter((row) => (!params.get('status') || row.status === params.get('status')) &&
          (!search || row.transferCode.toLowerCase().includes(search) || row.shipment.trackingCode.toLowerCase().includes(search))), params);
      } else if (path.endsWith('/receive')) {
        const row = rows.find((row) => path.endsWith(`/transfers/${row.id}/receive`));
        assert(row && path.includes(destination.id), 'receive the chosen transfer at its destination');
        received.push(row.id);
        row.status = 'COMPLETED'; row.workflow.canReceive = false; data = row;
      } else { unexpected.push(path); return route.abort(); }
      await route.fulfill({ json: { data, meta: {} } });
    });
    await page.goto('http://127.0.0.1:4202/test/ui-flow/index.html');
    await page.getByRole('tab', { name: 'Chuyển đến (105)' }).click();
    const pager = page.getByRole('navigation', { name: 'Phân trang chuyển đến' });
    for (let index = 0; index < 5; index++) {
      await pager.getByRole('button', { name: 'Sau', exact: true }).click();
      await expect(page.getByText(`TRF-${String((index + 1) * 20 + 1).padStart(3, '0')}`, { exact: true })).toBeVisible();
    }
    await expect(pager.getByText('Trang 6 / 6')).toBeVisible();
    await expect(pager.getByRole('button', { name: 'Sau', exact: true })).toBeDisabled();
    await page.getByLabel('Tìm mã chuyển kho hoặc vận đơn').fill('shp-101');
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Chuyển đến (1)' })).toBeVisible();
    assert(reads.some((read) => read.params.search === 'shp-101' && read.params.page === '1'), 'search resets server page');
    await page.getByRole('button', { name: 'Nhập kho đích', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /Xác nhận nhập kho/ }).click();
    await expect(modal).not.toBeVisible();
    assert.deepEqual(received, [uuid(1100)]);
    await page.getByRole('tab', { name: /Chuyển đến/ }).click();
    await page.getByLabel('Trạng thái chuyển kho').selectOption('COMPLETED');
    await expect(page.getByText('TRF-101', { exact: true })).toBeVisible();
    await page.getByLabel('Trạng thái chuyển kho').selectOption('PENDING');
    await expect(page.getByText('Không có chuyến đến', { exact: true })).toBeVisible();
    await page.getByLabel('Trạng thái chuyển kho').selectOption('');
    await page.getByRole('button', { name: 'Xóa nội dung tìm kiếm' }).click();
    await expect(page.getByRole('tab', { name: 'Chuyển đến (105)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Chuyển đi (105)' }).click();
    const outboundPager = page.getByRole('navigation', { name: 'Phân trang chuyển đi' });
    for (let index = 0; index < 5; index++) {
      await outboundPager.getByRole('button', { name: 'Sau', exact: true }).click();
      await expect(page.getByText(`TRF-${String((index + 1) * 20 + 1).padStart(3, '0')}`, { exact: true })).toBeVisible();
    }
    assert(reads.some((read) => read.params.direction === 'outbound' && read.params.page === '6'));
    assert(reads.every((read) => read.path.includes(destination.id)), 'all list reads use actor warehouse scope');
    await page.screenshot({ path: `test-results/transfer-pagination/${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    gate = new Promise((resolve) => { release = resolve; });
    await page.getByLabel('Tìm mã chuyển kho hoặc vận đơn').fill('TRF');
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await expect(page.getByText('Đang tải danh sách chuyến xuất', { exact: true })).toBeVisible();
    fail = true; release(); gate = undefined;
    await expect(page.getByText('Không thể tải chuyển kho', { exact: true })).toBeVisible({ timeout: 30000 });
    fail = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.getByText('TRF-001', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Tồn kho (1)' }).click();
    await expect(page.getByText('Đã tạo TRF-ACTIVE-OUTSIDE-PAGE', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo transfer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Đổi kho đích', exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await page.close();
    console.log(`PASS F07 ${width}px: both page 6, search/status reset, transfer 101 receive, loading/error/retry/empty`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
