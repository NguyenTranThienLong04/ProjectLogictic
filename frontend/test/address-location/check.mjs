import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
const searchMode = process.argv.includes('--search');

// Tests real page components and captured HTTP payloads; does not claim API/DB persistence.
const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/address-location', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4191, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    // Existing application font assets are unrelated to administrative lookup.
    const host = new URL(request.url()).hostname;
    if (!['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host) && !host.endsWith('.tile.openstreetmap.org')) external.push(request.url());
  });
  await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
  let addresses = [];
  const writes = [];
  let quotes = [];
  let shipments = [];
  let searches = 0;
  let searchResponse = 'success';
  const searchResult = { id: 'vn-1', displayName: '123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh', latitude: 10.77, longitude: 106.69 };
  const initialAddress = {
    id: '210e5c56-6639-46a3-98dd-dd6e3da0498d', label: 'Nhà', contactName: 'Nguyễn An', phone: '0901234567',
    streetAddress: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành', district: '',
    latitude: 13.114442, longitude: 26.442573, isDefault: true, createdAt: '2026-09-18', updatedAt: '2026-09-18',
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data;
    if (path.endsWith('/locations/address-search')) {
      searches++;
      const body = request.postDataJSON();
      assert(body.street && body.city);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (searchResponse === 'error') { await route.fulfill({ status: 503, json: { message: 'Unavailable' } }); return; }
      data = searchResponse === 'empty' ? [] : [searchResult, { ...searchResult, id: 'vn-2', displayName: 'Kết quả thứ hai' }];
    }
    else if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0 };
    else if (path.endsWith('/addresses') && request.method() === 'GET') data = addresses;
    else if (path.includes('/addresses') && ['POST', 'PATCH'].includes(request.method())) {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      data = { ...initialAddress, ...body };
      addresses = [data];
    } else if (path.endsWith('/pricing/quote')) {
      quotes.push(request.postDataJSON());
      data = { configVersion: 1, baseFee: 10000, weightFee: 0, codFee: 0, distanceFee: 0, surcharge: 0, discount: 0, totalFee: 10000 };
    } else if (path.endsWith('/shipments') && request.method() === 'POST') {
      shipments.push(request.postDataJSON());
      data = { id: 'created' };
    } else throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
    await route.fulfill({ json: { data, meta: {} } });
  });

  const city = page.getByRole('combobox', { name: 'Tỉnh / thành phố', exact: true });
  const ward = page.getByRole('combobox', { name: 'Phường / xã', exact: true });
  const choose = async (control, search, option) => {
    await control.fill(search);
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const open = async (screen) => {
    await page.goto(`http://127.0.0.1:4191/test/address-location/index.html?screen=${encodeURIComponent(screen)}`);
  };
  const map = page.locator('.leaflet-container');
  const confirm = page.getByRole('button', { name: 'Xác nhận vị trí' });
  const openMap = async () => page.getByRole('button', { name: /Chọn vị trí trên bản đồ|Thay đổi vị trí/ }).click();
  const pin = async () => {
    if (searchMode) {
      const before = searches;
      const previous = await selectedText().textContent();
      await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).evaluate((button) => { button.click(); button.click(); });
      await expect(page.getByRole('button', { name: 'Tìm địa chỉ', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: searchResult.displayName, exact: true }).waitFor();
      assert.equal(searches, before + 1);
      await expect(map).toHaveCount(0);
      await expect(selectedText()).toHaveText(previous);
      await page.getByRole('button', { name: searchResult.displayName, exact: true }).click();
      await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(1);
      await expect.poll(() => page.locator('.leaflet-tile[src*=".org/16/"]').count()).toBeGreaterThan(0);
      await expect(selectedText()).toHaveText(previous);
      const marker = page.locator('.leaflet-marker-draggable');
      await marker.scrollIntoViewIfNeeded();
      const box = await marker.boundingBox();
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + 50, box.y + 42, { steps: 8 });
      await page.mouse.up();
      const draft = await page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last().textContent();
      assert.notEqual(draft, '10.770000, 106.690000');
    } else await openMap();
    await map.click({ position: { x: 100, y: 120 } });
    await expect(confirm).toBeEnabled();
    await confirm.click();
  };
  const selectedText = () => page.locator('section[aria-label^="Vị trí"] > p[aria-live]');
  const near = (actual, expected) => actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < 0.002));
  const checkFocus = async (expected, zoom) => {
    await openMap();
    await expect(confirm).toBeDisabled();
    await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(0);
    await expect.poll(() => page.locator(`.leaflet-tile[src*=".org/${zoom}/"]`).count()).toBeGreaterThan(0);
    await map.focus();
    await page.keyboard.press('Enter');
    const text = await page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last().textContent();
    near(text.split(',').map(Number), expected);
    await page.locator('section[aria-label^="Vị trí"]').getByRole('button', { name: 'Hủy', exact: true }).click();
  };
  const stale = () => page.getByText('Địa chỉ đã thay đổi. Vui lòng chọn lại vị trí trên bản đồ.', { exact: true }).first();

  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    addresses = [];
    await open('/addresses');
    await expect(ward).toBeDisabled();
    await city.click();
    await expect(page.getByRole('option')).toHaveCount(34);
    await city.fill('not-a-province');
    await page.keyboard.press('Tab');
    await expect(city).toHaveValue('');
    await expect(ward).toBeDisabled();
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await expect(ward).toBeEnabled();
    await checkFocus([10.993, 106.638], 12);
    await ward.fill('ben thanh');
    await expect(page.getByRole('option')).toHaveCount(1);
    if ([375, 1440].includes(size.width)) {
      await page.locator('section[aria-labelledby="address-form-title"]').screenshot({ path: `frontend/.vite/address-location/selector-${size.width}.png` });
    }
    await page.keyboard.press('Enter');
    await expect(ward).toHaveValue('Bến Thành');
    await checkFocus([10.77, 106.695], 15);
    await choose(ward, 'bến thành', 'Bến Thành');
    await page.getByLabel('Tên gợi nhớ').fill('Nhà');
    await page.getByLabel('Tên người liên hệ').fill('Nguyễn An');
    await page.getByLabel('Số điện thoại', { exact: true }).fill('0901234567');
    if (searchMode) {
      const before = searches;
      for (let i = 0; i < 10; i++) await page.getByLabel('Số nhà, tên đường').fill(`${i} Nguyễn Trãi`);
      await page.getByLabel('Số nhà, tên đường').blur();
      assert.equal(searches, before);
    }
    await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
    await pin();
    const selected = await selectedText().textContent();
    await page.getByRole('button', { name: 'Lưu địa chỉ', exact: true }).click();
    await expect(page.getByText('Địa chỉ đã được lưu.', { exact: true })).toBeVisible();
    assert.equal(writes.at(-1).body.district, '');
    near([writes.at(-1).body.latitude, writes.at(-1).body.longitude], selected.split(',').map(Number));
    assert(!('confirmedAddressFingerprint' in writes.at(-1).body));

    await page.getByRole('button', { name: 'Sửa', exact: true }).click();
    await expect(selectedText()).toHaveText(selected);
    await page.getByLabel('Tên người liên hệ').fill('Nguyễn Bình');
    await page.getByLabel('Số điện thoại', { exact: true }).fill('0987654321');
    await expect(selectedText()).toHaveText(selected);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByText('Địa chỉ đã được cập nhật.', { exact: true })).toBeVisible();
    near([writes.at(-1).body.latitude, writes.at(-1).body.longitude], selected.split(',').map(Number));
    await page.getByRole('button', { name: 'Sửa', exact: true }).click();
    await page.getByLabel('Số nhà, tên đường').fill('124 Nguyễn Trãi');
    await expect(stale()).toBeVisible();
    await expect(selectedText()).toHaveText('Chưa chọn vị trí');
    const before = writes.length;
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.locator('form').getByRole('alert').last()).toBeVisible();
    assert.equal(writes.length, before);
    await pin();
    await choose(ward, 'sai gon', 'Sài Gòn');
    await expect(stale()).toBeVisible();
    await pin();
    await choose(city, 'hà nội', 'Hà Nội');
    await expect(stale()).toBeVisible();
    await expect(ward).toHaveValue('');
    await ward.fill('ben thanh');
    await expect(page.getByRole('option')).toHaveCount(0);
    await choose(ward, 'hoan kiem', 'Hoàn Kiếm');
    await pin();
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByText('Địa chỉ đã được cập nhật.', { exact: true })).toBeVisible();
    assert.equal(writes.at(-1).body.city, 'Hà Nội');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS ${size.width}x${size.height}: canonical search, dependent wards, focus/no selection, saved create/edit, street/ward/province stale, contact preserved, no overflow`);
  }

  // Existing coordinate is accepted on initial load, then invalidated by address edits.
  addresses = [{ ...initialAddress }];
  await open('/addresses');
  await page.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(selectedText()).toHaveText('13.114442, 26.442573');
  await openMap();
  await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(1);
  await page.getByLabel('Số nhà, tên đường').fill('125 Nguyễn Trãi');
  await expect(map).toHaveCount(0); // Discard the old draft when the address changes while open.
  await expect(stale()).toBeVisible();
  await checkFocus([10.77, 106.695], 15);
  console.log('PASS saved legacy Africa coordinate: existing marker, edit invalidation, draft discarded, ward fallback');

  for (const screen of ['/shipments/new', '/quote']) {
    quotes = []; shipments = [];
    await open(screen);
    await page.getByLabel('Địa chỉ đã lưu', { exact: true }).selectOption(initialAddress.id);
    await page.getByLabel('Tên người nhận').fill('Người nhận');
    await page.getByLabel('Số điện thoại', { exact: true }).fill('0901234567');
    await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await choose(ward, 'ben thanh', 'Bến Thành');
    await page.getByLabel('Mô tả hàng hóa').fill('Kiện hàng');
    await page.locator('input[name="shippingFeePayer"][value="SENDER"]').check();
    await pin();
    await page.getByLabel('Số nhà, tên đường').fill('126 Nguyễn Trãi');
    await expect(stale()).toBeVisible();
    const calculate = page.getByRole('button', { name: screen === '/quote' ? 'Tính phí vận chuyển' : 'Tính lại phí', exact: true });
    await calculate.click();
    await expect.poll(() => quotes.length).toBe(1);
    assert(!('latitude' in quotes[0].delivery));
    assert(!('longitude' in quotes[0].delivery));
    await pin();
    const confirmed = (await selectedText().textContent()).split(',').map(Number);
    await page.getByLabel('Tên người nhận').fill('Người nhận khác');
    await calculate.click();
    await expect.poll(() => quotes.length).toBe(2);
    near([quotes.at(-1).delivery.latitude, quotes.at(-1).delivery.longitude], confirmed);
    if (screen === '/shipments/new') {
      await page.getByRole('button', { name: 'Tạo vận đơn', exact: true }).click();
      await expect.poll(() => shipments.length).toBe(1);
      near([shipments[0].deliveryAddress.latitude, shipments[0].deliveryAddress.longitude], confirmed);
      assert.equal(shipments[0].deliveryAddress.streetAddress, '126 Nguyễn Trãi');
    }
    console.log(`PASS ${screen}: stale omitted from actual HTTP payload, current confirmation included, contact change preserved`);
  }
  if (searchMode) {
    addresses = [];
    for (const failure of ['empty', 'error']) {
      searchResponse = failure;
      await open('/addresses');
      await choose(city, 'ho chi minh', 'Hồ Chí Minh');
      await choose(ward, 'ben thanh', 'Bến Thành');
      await expect(page.getByRole('button', { name: 'Tìm địa chỉ', exact: true })).toBeDisabled();
      await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
      await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).click();
      await expect(page.getByText('Không tìm thấy địa chỉ chính xác. Bạn có thể chọn trực tiếp trên bản đồ.')).toBeVisible();
      await openMap();
      await map.click({ position: { x: 100, y: 120 } });
      await confirm.click();
      assert.notEqual(await selectedText().textContent(), 'Chưa chọn vị trí');
    }
    searchResponse = 'success';
    await open('/addresses');
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
    await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).click();
    await page.getByLabel('Số nhà, tên đường').fill('124 Nguyễn Trãi');
    await page.waitForTimeout(400);
    await expect(page.getByRole('list', { name: 'Kết quả tìm địa chỉ' })).toHaveCount(0);
    await expect(map).toHaveCount(0);
    console.log('PASS explicit search: typing 0, double-click 1, choice/draft/drag/confirm, all forms, stale payloads, fail/empty manual fallback, cancelled stale response');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS no page errors, no runtime third-party administrative/geocoding requests (mock API integration only)');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
