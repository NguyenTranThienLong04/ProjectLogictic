import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { normalizeAdministrativeSearch } from '../../src/features/addresses/administrative-model.ts';

const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/warehouse-list', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4192, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
  const base = { ward: 'Bến Thành', district: '', city: 'Hồ Chí Minh', latitude: 10.77, longitude: 106.69, isActive: true };
  let records = Array.from({ length: 23 }, (_, index) => ({ ...base, id: `wh-${index}`, code: `WH-${String(index).padStart(2, '0')}`, name: `Kho ${index}`, address: '123 Nguyễn Trãi' }));
  records[0].name = 'Kho Đầu Mối';
  records[1] = { ...records[1], ward: 'Chợ Quán', isActive: false };
  records[2] = { ...records[2], city: 'Hà Nội', ward: 'Ba Đình', address: '45 Đội Cấn' };
  let lastQuery;
  let writes = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let data;
    if (url.pathname.endsWith('/warehouses') && request.method() === 'GET') {
      lastQuery = Object.fromEntries(url.searchParams);
      const { search = '', city, ward, isActive, page: current = '1', limit = '20' } = lastQuery;
      assert.equal(Number(limit), 20);
      const matches = records.filter((item) => (!city || item.city === city) && (!ward || item.ward === ward) &&
        (!isActive || String(item.isActive) === isActive) && normalizeAdministrativeSearch([item.code, item.name, item.address, item.ward, item.city].join(' ')).includes(normalizeAdministrativeSearch(search)));
      data = { items: matches.slice((Number(current) - 1) * Number(limit), Number(current) * Number(limit)), pagination: { page: Number(current), limit: Number(limit), total: matches.length, totalPages: Math.ceil(matches.length / Number(limit)) } };
    } else if (url.pathname.includes('/warehouses/') && request.method() === 'PATCH') {
      const id = url.pathname.split('/').at(-1);
      records = records.map((item) => item.id === id ? { ...item, ...request.postDataJSON() } : item);
      data = records.find((item) => item.id === id);
      writes++;
    } else if (url.pathname.endsWith('/notifications')) data = { items: [], pagination: { total: 0 } };
    else if (url.pathname.endsWith('/notifications/unread-count')) data = { count: 0 };
    else throw new Error(`Unexpected request: ${request.method()} ${url.pathname}`);
    await route.fulfill({ json: { data, meta: {} } });
  });
  const form = page.getByRole('region', { name: 'Biểu mẫu kho hàng', exact: true });
  const list = page.locator('section[aria-labelledby="warehouse-list-title"]');
  const search = page.getByLabel('Tìm kho', { exact: true });
  const city = page.getByRole('combobox', { name: 'Lọc tỉnh / thành phố', exact: true });
  const ward = page.getByRole('combobox', { name: 'Lọc phường / xã', exact: true });
  const choose = async (control, text, name) => {
    await control.fill(text);
    await page.getByRole('option', { name, exact: true }).click();
  };
  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.goto('http://127.0.0.1:4192/test/address-location/index.html?screen=/admin/warehouses');
    await expect(list.locator('p[role="status"]')).toHaveText('23 kho phù hợp');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `full list overflow at ${size.width}`);
    await page.screenshot({ path: `frontend/.vite/warehouse-list/warehouses-${size.width}.png`, fullPage: false });
    await list.getByRole('button', { name: 'Sau', exact: true }).click();
    await expect.poll(() => lastQuery.page).toBe('2');
    await list.getByRole('button', { name: 'Trước', exact: true }).click();
    await expect.poll(() => lastQuery.page).toBe('1');
    await form.getByLabel('Tên kho hàng', { exact: true }).fill('Bản nháp giữ nguyên');
    for (const [term, count] of [['WH-00', 1], ['dau moi', 1], ['Đầu Mối', 1], ['doi can', 1], ['Nguyễn Trãi', 22], ['khong-ton-tai', 0]]) {
      await search.fill(term);
      await expect(list.locator('p[role="status"]')).toHaveText(`${count} kho phù hợp`);
      await expect(form.getByLabel('Tên kho hàng', { exact: true })).toHaveValue('Bản nháp giữ nguyên');
    }
    await expect(list.getByText('Không có kho phù hợp', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await choose(ward, 'cho quan', 'Chợ Quán');
    await page.getByLabel('Trạng thái kho').selectOption('false');
    await expect(list.locator('p[role="status"]')).toHaveText('1 kho phù hợp');
    assert.equal(lastQuery.ward, 'Chợ Quán');
    await choose(city, 'ha noi', 'Hà Nội');
    await expect(ward).toHaveValue('Tất cả phường/xã');
    await expect(list.locator('p[role="status"]')).toHaveText('0 kho phù hợp');
    assert.equal(lastQuery.ward, undefined);
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await expect(ward).toBeDisabled();
    await expect(list.locator('p[role="status"]')).toHaveText('23 kho phù hợp');
    await search.fill('WH-00');
    await expect(list.locator('p[role="status"]')).toHaveText('1 kho phù hợp');
    await list.getByRole('button', { name: 'Sửa kho', exact: true }).click();
    await form.getByRole('button', { name: 'Thay đổi vị trí', exact: true }).click();
    await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(1);
    const confirm = form.getByRole('button', { name: 'Xác nhận vị trí', exact: true });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    const cancel = form.getByRole('button', { name: 'Hủy', exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    const save = form.getByRole('button', { name: 'Lưu thay đổi', exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const layout = await form.evaluate((element) => ({ position: getComputedStyle(element).position, overflow: getComputedStyle(element).overflowY, height: element.clientHeight, scrollHeight: element.scrollHeight }));
    assert.equal(layout.position, size.width >= 768 ? 'sticky' : 'static');
    if (size.width >= 768) { assert.equal(layout.overflow, 'auto'); assert(layout.height < size.height); assert(layout.scrollHeight > layout.height); }
    else assert.equal(layout.overflow, 'visible');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${size.width}`);
    await cancel.click();
    await form.getByLabel('Tên kho hàng', { exact: true }).fill('Kho Đầu Mối');
    const before = writes;
    await save.click();
    await expect.poll(() => writes).toBe(before + 1);
    await expect(search).toHaveValue('WH-00');
    await expect(list.locator('p[role="status"]')).toHaveText('1 kho phù hợp');
    console.log(`PASS ${size.width}x${size.height}: search, dependent filters, clear, empty, pagination, draft preserved, edit marker, map/footer scroll, save retains filters`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
