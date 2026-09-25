// Real production page with intercepted HTTP: verifies UX/contracts, not DB or staging persistence.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {
  root, configFile: `${root}/vite.config.ts`,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/drivers', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4193, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const warehouses = Array.from({ length: 101 }, (_, i) => ({ id: uuid(i + 1), code: `WH-${i}`, name: `Kho vận hành ${i}`, city: i === 100 ? 'Đà Nẵng' : 'Hà Nội', isActive: true }));
  let rows, lastQuery, createBody, updateBody, rejectUpdate;
  const paginate = (items, q) => {
    const page = Number(q.page ?? 1), limit = Number(q.limit ?? 20);
    return { items: items.slice((page - 1) * limit, page * limit), page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) };
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), q = Object.fromEntries(url.searchParams);
    let data = {};
    if (url.pathname.endsWith('/warehouses')) {
      const { items, ...pagination } = paginate(warehouses, q); data = { items, pagination };
    } else if (url.pathname.endsWith('/users')) {
      data = paginate([{ id: uuid(500), fullName: 'Tài xế mới', email: 'new@example.test', role: 'DRIVER', status: 'ACTIVE' }], q);
    } else if (url.pathname.endsWith('/drivers') && request.method() === 'GET') {
      if (q.limit === '20') lastQuery = q;
      data = paginate(rows.filter((row) => (!q.search || `${row.fullName} ${row.email} ${row.employeeCode}`.toLowerCase().includes(q.search.toLowerCase())) && (!q.capability || row.capabilities.includes(q.capability)) && (!q.status || row.status === q.status) && (!q.operatingWarehouseId || row.operatingWarehouse.id === q.operatingWarehouseId)), q);
    } else if (url.pathname.endsWith('/drivers') && request.method() === 'POST') {
      createBody = request.postDataJSON();
      data = { ...rows[0], ...createBody, id: uuid(999), operatingWarehouse: warehouses.find((w) => w.id === createBody.operatingWarehouseId) };
      rows.push(data);
    } else if (url.pathname.includes('/drivers/') && request.method() === 'PATCH') {
      updateBody = request.postDataJSON();
      if (rejectUpdate) return route.fulfill({ status: 409, json: { message: 'Complete or reassign the active shipment before changing operating warehouse' } });
      const row = rows.find((r) => url.pathname.endsWith(r.id));
      row.operatingWarehouse = warehouses.find((w) => w.id === updateBody.operatingWarehouseId); data = row;
    } else if (url.pathname.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0, page: 1, totalPages: 0 };
    await route.fulfill({ json: { data, meta: {} } });
  });
  const form = page.getByRole('region', { name: 'Tạo hồ sơ tài xế', exact: true });
  const list = page.locator('section[aria-labelledby="driver-list-title"]');
  const choose = async (control, query, option) => {
    await control.fill(query);
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const search = async (term) => {
    await page.getByLabel('Tìm tài xế', { exact: true }).fill(term);
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  };
  for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    rows = Array.from({ length: 23 }, (_, i) => ({ id: uuid(200 + i), userId: uuid(300 + i), fullName: `Nguyễn Văn Tài Xế Tên Rất Dài ${i}`, email: `driver${i}@very-long-domain.example.test`, employeeCode: `DRV-${i}`, vehicleType: 'Xe máy', vehiclePlate: '59A1-12345', capabilities: i === 0 ? ['PICKUP', 'DELIVERY', 'LINE_HAUL'] : ['PICKUP'], status: i === 1 ? 'BUSY' : 'OFFLINE', operatingWarehouse: warehouses[0] }));
    createBody = updateBody = null; rejectUpdate = false;
    await page.setViewportSize(size);
    await page.goto('http://127.0.0.1:4193/test/address-location/index.html?screen=/admin/drivers');
    await expect(list.locator('p[role=status]')).toHaveText('23 tài xế phù hợp');
    await list.getByRole('button', { name: 'Sau', exact: true }).click();
    await expect.poll(() => lastQuery.page).toBe('2');
    await form.getByLabel('Mã nhân viên', { exact: true }).fill('DRAFT');
    for (const term of ['DRV-0', 'driver0@', 'Dài 0']) {
      await search(term);
      await expect(list.locator('p[role=status]')).toHaveText('1 tài xế phù hợp');
      assert.equal(lastQuery.page, '1');
      await expect(form.getByLabel('Mã nhân viên', { exact: true })).toHaveValue('DRAFT');
    }
    await search('missing');
    await expect(list.getByText('Không có tài xế phù hợp', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await page.getByLabel('Lọc năng lực').selectOption('LINE_HAUL');
    await page.getByLabel('Lọc khả dụng').selectOption('OFFLINE');
    await choose(page.getByRole('combobox', { name: 'Lọc kho vận hành' }), 'WH-0', '[WH-0] Kho vận hành 0 — Hà Nội');
    await expect(list.locator('p[role=status]')).toHaveText('1 tài xế phù hợp');
    assert.equal(lastQuery.capability, 'LINE_HAUL'); assert.equal(lastQuery.status, 'OFFLINE'); assert.equal(lastQuery.operatingWarehouseId, uuid(1));
    const table = list.getByRole('table');
    await expect(table.locator('[title="driver0@very-long-domain.example.test"]')).toHaveCSS('text-overflow', 'ellipsis');
    await expect(table.locator('[title="DRV-0"]')).toHaveCSS('text-overflow', 'ellipsis');
    assert.equal(await table.evaluate((el) => getComputedStyle(el).display), size.width >= 1024 ? 'table' : 'block');
    if (size.width >= 1024) {
      assert.ok(await table.evaluate((el) => el.clientWidth >= 1160));
      const region = list.getByRole('region', { name: 'Danh sách hồ sơ tài xế' });
      assert.ok(await region.evaluate((el) => el.scrollWidth > el.clientWidth));
      await region.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    }
    for (const button of await list.getByRole('button', { name: /Đình chỉ|Bật tuyến|Gỡ tuyến|Đổi kho/ }).all()) {
      assert.equal(await button.evaluate((el) => getComputedStyle(el).whiteSpace), 'nowrap');
      await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
    }
    await list.getByRole('button', { name: 'Đình chỉ', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Xác nhận đình chỉ' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Xác nhận đình chỉ' }).getByRole('button', { name: 'Quay lại', exact: true }).click();
    const metrics = await form.evaluate((el) => ({ position: getComputedStyle(el).position, overflow: getComputedStyle(el).overflowY, height: el.clientHeight, max: innerHeight - 48 }));
    assert.equal(metrics.position, size.width >= 768 ? 'sticky' : 'static');
    if (size.width >= 768) { assert.equal(metrics.overflow, 'auto'); assert.ok(metrics.height <= metrics.max); }
    await form.getByRole('button', { name: 'Tạo hồ sơ', exact: true }).scrollIntoViewIfNeeded();
    await expect(form.getByRole('button', { name: 'Tạo hồ sơ', exact: true })).toBeInViewport();
    await list.getByRole('button', { name: 'Đổi kho', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Đổi kho vận hành', exact: true });
    // Warehouse 101 proves all catalogue pages are loaded; code/name/city searches all work.
    for (const term of ['WH-100', 'van hanh 100', 'da nang']) {
      await dialog.getByRole('combobox').fill(term);
      await expect(page.getByRole('option', { name: '[WH-100] Kho vận hành 100 — Đà Nẵng', exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: '[WH-100] Kho vận hành 100 — Đà Nẵng', exact: true }).click();
    rejectUpdate = true;
    await dialog.getByRole('button', { name: 'Lưu kho vận hành' }).click();
    await expect(dialog.getByText('Complete or reassign the active shipment before changing operating warehouse')).toBeVisible();
    assert.equal(rows[0].operatingWarehouse.id, uuid(1));
    rejectUpdate = false;
    await dialog.getByRole('button', { name: 'Lưu kho vận hành' }).click();
    await expect(dialog).not.toBeVisible();
    assert.deepEqual(updateBody, { operatingWarehouseId: uuid(101) });
    await expect(list.locator('p[role=status]')).toHaveText('0 tài xế phù hợp');
    await expect(page.getByLabel('Lọc năng lực')).toHaveValue('LINE_HAUL');
    await expect(form.getByLabel('Mã nhân viên', { exact: true })).toHaveValue('DRAFT');
    await form.getByLabel('Tài khoản DRIVER', { exact: true }).selectOption(uuid(500));
    await choose(form.getByRole('combobox', { name: 'Kho vận hành', exact: true }), 'da nang', '[WH-100] Kho vận hành 100 — Đà Nẵng');
    await form.getByLabel('Loại phương tiện').fill('Xe máy');
    await form.getByLabel('Biển số').fill('59A1-99999');
    await form.getByRole('button', { name: 'Tạo hồ sơ', exact: true }).click();
    await expect.poll(() => createBody).not.toBeNull();
    assert.deepEqual(createBody, { userId: uuid(500), operatingWarehouseId: uuid(101), employeeCode: 'DRAFT', vehicleType: 'Xe máy', vehiclePlate: '59A1-99999' });
    await expect(form.getByLabel('Mã nhân viên', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Lọc năng lực')).toHaveValue('LINE_HAUL');
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await page.getByLabel('Lọc khả dụng').selectOption('BUSY');
    await expect(list.getByRole('button', { name: 'Đổi kho' })).toBeDisabled();
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await expect(list.locator('p[role=status]')).toHaveText('24 tài xế phù hợp');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${size.width}`);
    assert.ok(await list.evaluate((el) => el.scrollWidth <= el.clientWidth), `list overflow at ${size.width}`);
    await mkdir(`${root}/.vite/drivers-evidence`, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await form.evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `${root}/.vite/drivers-evidence/${size.width}.png` });
    console.log(`PASS ${size.width}x${size.height}: layout, search/filter/page, warehouse search, create/update, conflict, retained state`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
