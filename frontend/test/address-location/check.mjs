import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
const validatedSearch = process.argv.includes('--validated-search');
const currentLocation = process.argv.includes('--current-location');
const directSearch = validatedSearch || process.argv.includes('--direct-search');
const searchMode = directSearch || process.argv.includes('--search');

// Optional cross-layer regression: execute the built backend service against raw
// provider fixtures, then render its filtered response in the real frontend.
// Requires npm run build. No live provider credentials or DB are used.
let geocoder;
let selectedWard;
if (validatedSearch) {
  const { AddressSearchService } = await import('../../../backend/dist/modules/locations/address-search.service.js');
  geocoder = new AddressSearchService({ get: () => 'fixture-key' }, {
    increment: async () => ({ totalHits: 1, timeToExpire: 1, isBlocked: false, timeToBlockExpire: 0 }),
  });
  const { findProvince, findWard } = await import('../../../backend/dist/common/addresses/administrative-data.js');
  selectedWard = (body) => findWard(findProvince(body.city)?.code, body.ward);
}

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
  if (currentLocation) {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 10.769508432, longitude: 106.690795367 });
  }
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
  let warehouses = [];
  const warehouseWrites = [];
  const writes = [];
  let quotes = [];
  let shipments = [];
  let searches = 0;
  let searchResponse = 'success';
  // Matches the real backend normalization of raw "10.7695084", "106.6907953".
  const searchResult = { id: 'vn-1', displayName: '123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh', latitude: 10.769508, longitude: 106.690795 };
  const numericPair = (body) => {
    assert.equal(typeof body.latitude, 'number');
    assert.equal(typeof body.longitude, 'number');
    assert(Number.isFinite(body.latitude) && Number.isFinite(body.longitude));
    if (directSearch) {
      assert.equal(body.latitude, searchResult.latitude);
      assert.equal(body.longitude, searchResult.longitude);
    }
  };
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
      assert(body.street && body.city && body.ward);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (searchResponse === 'error') { await route.fulfill({ status: 503, json: { message: 'Unavailable' } }); return; }
      data = searchResponse === 'empty' ? [] : [searchResult, { ...searchResult, id: 'vn-2', displayName: 'Kết quả thứ hai' }];
      if (geocoder) {
        const ward = selectedWard(body);
        const benThanh = body.city === 'Hồ Chí Minh' && body.ward === 'Bến Thành';
        searchResult.latitude = benThanh ? 10.769508 : ward.latitude;
        searchResult.longitude = benThanh ? 106.690795 : ward.longitude;
        searchResult.displayName = `${body.street}, ${ward.fullName}, ${body.city}`;
        const valid = {
          place_id: searchResult.id,
          display_name: benThanh ? `${body.street}, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, Việt Nam` : searchResult.displayName,
          lat: benThanh ? '10.7695084' : String(ward.latitude), lon: benThanh ? '106.6907953' : String(ward.longitude),
          // Live provider hierarchy anomaly: structured ward/house/road and bbox
          // win over an ambiguous city level; state is absent.
          address: { country_code: 'vn', suburb: body.ward, road: 'Đường Nguyễn Trãi', house_number: body.street.split(' ')[0],
            ...(benThanh ? { city: 'Thành phố Thủ Đức', neighbourhood: 'Khu phố 3' } : {}),
          },
        };
        const thuDuc = {
          ...valid, place_id: 'thu-duc', lat: '10.851', lon: '106.759',
          display_name: '123 Nguyễn Trãi, Thành phố Thủ Đức, Hồ Chí Minh',
          address: { ...valid.address, city: 'Thành phố Thủ Đức', suburb: 'Linh Chiểu' },
        };
        const fixtures = {
          success: [thuDuc, valid], empty: [], 'thu-duc': [thuDuc],
          'wrong-province': [{ ...valid, address: { ...valid.address, state: 'Hà Nội' } }],
          'wrong-ward': [{ ...valid, address: { ...valid.address, suburb: 'Phường Sài Gòn' } }],
          'wrong-region': [{ ...valid, address: { ...valid.address, region: 'Hà Nội' } }],
          'wrong-neighbourhood': [{ ...valid, address: { ...valid.address, neighbourhood: 'Phường Sài Gòn' } }],
          'outside-area': [{ ...valid, lat: '10.851', lon: '106.759' }],
        };
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
          assert.equal(url.searchParams.get('countrycodes'), 'vn');
          assert.equal(url.searchParams.get('bounded'), '1');
          assert.equal(url.searchParams.get('normalizeaddress'), '1');
          if (url.pathname.endsWith('/structured')) {
            assert.equal(url.searchParams.get('street'), body.street);
            assert.equal(url.searchParams.get('state'), body.city);
            assert.equal(url.searchParams.has('q'), false);
          } else {
            assert.equal(url.searchParams.get('q'), `${body.street}, ${body.ward}, ${body.city}, Việt Nam`);
          }
          assert(url.searchParams.get('viewbox'));
          return new Response(JSON.stringify(fixtures[searchResponse]));
        };
        try { data = await geocoder.search(body); }
        finally { globalThis.fetch = originalFetch; }
        assert(!data.some((result) => result.id === 'thu-duc'));
        for (const result of data) {
          assert.equal(result.city, body.city);
          assert.equal(result.ward, body.ward);
          assert.equal(result.displayName, searchResult.displayName);
        }
      }
    }
    else if (path.includes('/warehouses') && ['POST', 'PATCH'].includes(request.method())) {
      const body = request.postDataJSON();
      numericPair(body);
      warehouseWrites.push(body);
      data = { id: 'warehouse-test', isActive: true, ...warehouses[0], ...body };
      warehouses = [data];
    }
    else if (path.endsWith('/warehouses')) data = { items: warehouses, pagination: { page: 1, totalPages: 1, total: warehouses.length } };
    else if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0 };
    else if (path.endsWith('/addresses') && request.method() === 'GET') data = addresses;
    else if (path.includes('/addresses') && ['POST', 'PATCH'].includes(request.method())) {
      const body = request.postDataJSON();
      numericPair(body);
      writes.push({ method: request.method(), body });
      data = { ...initialAddress, ...body };
      addresses = [data];
    } else if (path.endsWith('/pricing/quote')) {
      const body = request.postDataJSON();
      if ('latitude' in body.delivery) numericPair(body.delivery);
      quotes.push(body);
      data = { configVersion: 1, baseFee: 10000, weightFee: 0, codFee: 0, distanceFee: 0, surcharge: 0, discount: 0, totalFee: 10000 };
    } else if (path.endsWith('/shipments') && request.method() === 'POST') {
      const body = request.postDataJSON();
      numericPair(body.deliveryAddress);
      shipments.push(body);
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
    if (currentLocation) {
      const previousCity = await city.inputValue();
      const previousWard = await ward.inputValue();
      const previous = await selectedText().textContent();
      const previousSearch = searchResponse;
      searchResponse = 'empty';
      await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).click();
      await expect(page.getByText('Không tìm thấy địa chỉ chính xác.', { exact: false })).toBeVisible();
      searchResponse = previousSearch;
      await page.getByRole('button', { name: 'Dùng vị trí hiện tại', exact: true }).click();
      await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(1);
      await expect(page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last()).toHaveText('10.769508, 106.690795');
      await expect(selectedText()).toHaveText(previous);
      await expect(city).toHaveValue(previousCity);
      await expect(ward).toHaveValue(previousWard);
      await expect.poll(() => page.locator('.leaflet-tile[src*=".org/16/"]').count()).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => {
        const mapBox = document.querySelector('.leaflet-container').getBoundingClientRect();
        const markerBox = document.querySelector('.leaflet-marker-draggable').getBoundingClientRect();
        return Math.max(Math.abs(markerBox.x + markerBox.width / 2 - mapBox.x - mapBox.width / 2),
          Math.abs(markerBox.y + markerBox.height / 2 - mapBox.y - mapBox.height / 2));
      })).toBeLessThan(2);
      if (previousCity === 'Hà Nội') await expect(page.getByText('Vị trí hiện tại có vẻ không khớp', { exact: false })).toBeVisible();
      await confirm.click();
      await expect(selectedText()).toHaveText('10.769508, 106.690795');
      return;
    }
    if (searchMode) {
      const previousCity = await city.inputValue();
      const previousWard = await ward.inputValue();
      const before = searches;
      const previous = await selectedText().textContent();
      await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).evaluate((button) => { button.click(); button.click(); });
      await expect(page.getByRole('button', { name: 'Tìm địa chỉ', exact: true })).toBeDisabled();
      await page.getByRole('list', { name: 'Kết quả tìm địa chỉ' }).waitFor();
      assert.equal(searches, before + 1);
      await expect(map).toHaveCount(0);
      await expect(selectedText()).toHaveText(previous);
      await page.getByRole('button', { name: searchResult.displayName, exact: true }).click();
      await expect(city).toHaveValue(previousCity);
      await expect(ward).toHaveValue(previousWard);
      await expect(page.locator('.leaflet-marker-draggable')).toHaveCount(1);
      await expect.poll(() => page.locator('.leaflet-tile[src*=".org/16/"]').count()).toBeGreaterThan(0);
      const mapBox = await map.boundingBox();
      const markerBox = await page.locator('.leaflet-marker-draggable').boundingBox();
      assert(Math.abs(markerBox.x + markerBox.width / 2 - mapBox.x - mapBox.width / 2) < 2);
      assert(Math.abs(markerBox.y + markerBox.height / 2 - mapBox.y - mapBox.height / 2) < 2);
      await expect(selectedText()).toHaveText(previous);
      if (directSearch) {
        // Do not click/drag the map: Leaflet would replace the provider draft.
        // Rendering toFixed also fails at runtime if either draft field is a string.
        await expect(page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last())
          .toHaveText(`${searchResult.latitude.toFixed(6)}, ${searchResult.longitude.toFixed(6)}`);
        await confirm.click();
        await expect(selectedText()).toHaveText(`${searchResult.latitude.toFixed(6)}, ${searchResult.longitude.toFixed(6)}`);
        return;
      }
      const marker = page.locator('.leaflet-marker-draggable');
      await marker.scrollIntoViewIfNeeded();
      const box = await marker.boundingBox();
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + 50, box.y + 42, { steps: 8 });
      await page.mouse.up();
      const draft = await page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last().textContent();
      assert.notEqual(draft, '10.769508, 106.690795');
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
    warehouses = [];
    await open('/admin/warehouses');
    await expect(ward).toBeDisabled();
    await page.getByLabel('Mã kho (viết hoa)').fill('WH-TEST');
    await page.getByLabel('Tên kho hàng', { exact: true }).fill('Kho kiểm thử');
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await choose(ward, 'ben thanh', 'Bến Thành');
    const beforeTyping = searches;
    for (let i = 0; i < 10; i++) await page.getByLabel('Số nhà / tên đường').fill(`${i} Nguyễn Trãi`);
    await page.getByLabel('Số nhà / tên đường').fill('123 Nguyễn Trãi');
    assert.equal(searches, beforeTyping);
    const beforeCreate = warehouseWrites.length;
    await page.getByRole('button', { name: 'Tạo kho hàng', exact: true }).click();
    await expect(page.getByText('Vui lòng chọn và xác nhận vị trí trên bản đồ.', { exact: true })).toBeVisible();
    assert.equal(warehouseWrites.length, beforeCreate);
    await pin();
    if ([375, 1440].includes(size.width)) {
      await page.locator('form').first().screenshot({ path: `frontend/.vite/address-location/warehouse-${size.width}.png` });
    }
    await page.getByRole('button', { name: 'Tạo kho hàng', exact: true }).click();
    await expect.poll(() => warehouseWrites.length).toBe(beforeCreate + 1);
    assert.equal(warehouseWrites.at(-1).district, '');
    await open('/admin/warehouses');
    await page.getByRole('button', { name: 'Sửa kho', exact: true }).click();
    const savedCoordinate = `${warehouses[0].latitude.toFixed(6)}, ${warehouses[0].longitude.toFixed(6)}`;
    await expect(selectedText()).toHaveText(savedCoordinate);
    await openMap();
    await expect(page.locator('section[aria-label^="Vị trí"] > p[role="status"]').last()).toHaveText(savedCoordinate);
    await page.locator('section[aria-label^="Vị trí"]').getByRole('button', { name: 'Hủy', exact: true }).click();
    await page.getByLabel('Tên kho hàng', { exact: true }).fill('Kho đổi tên');
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect.poll(() => warehouseWrites.length).toBe(beforeCreate + 2);
    await page.getByRole('button', { name: 'Sửa kho', exact: true }).click();
    await page.getByLabel('Số nhà / tên đường').fill('456 Nguyễn Trãi');
    await expect(stale()).toBeVisible();
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    assert.equal(warehouseWrites.length, beforeCreate + 2);
    await choose(ward, 'sai gon', 'Sài Gòn');
    await expect(stale()).toBeVisible();
    await pin();
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect.poll(() => warehouseWrites.length).toBe(beforeCreate + 3);
    await page.getByRole('button', { name: 'Sửa kho', exact: true }).click();
    await choose(city, 'ha noi', 'Hà Nội');
    await expect(ward).toHaveValue('');
    await expect(stale()).toBeVisible();
    assert.equal(await page.locator('input[name="latitude"], input[name="longitude"], input[name="city"], input[name="ward"], input[name="district"]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS Warehouse ${size.width}x${size.height}: create, edit/reload, metadata preservation, stale blocking, province reset, no manual coordinate inputs/overflow`);
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

    await open('/addresses'); // Reload via GET before editing the persisted fixture result.
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
    for (const failure of ['empty', 'error', ...(validatedSearch ? ['thu-duc', 'wrong-province', 'wrong-ward', 'wrong-region', 'wrong-neighbourhood', 'outside-area'] : [])]) {
      searchResponse = failure;
      await open('/addresses');
      await choose(city, 'ho chi minh', 'Hồ Chí Minh');
      await choose(ward, 'ben thanh', 'Bến Thành');
      await expect(page.getByRole('button', { name: 'Tìm địa chỉ', exact: true })).toBeDisabled();
      await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
      await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).click();
      await expect(page.getByText(failure !== 'error'
        ? 'Không tìm thấy địa chỉ chính xác. Bạn có thể đặt pin thủ công trong khu vực đã chọn.'
        : 'Không thể tìm địa chỉ lúc này. Hãy thử lại hoặc đặt pin thủ công.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Kết quả tìm địa chỉ' })).toHaveCount(0);
      await openMap();
      await map.click({ position: { x: 100, y: 120 } });
      await confirm.click();
      assert.notEqual(await selectedText().textContent(), 'Chưa chọn vị trí');
      await expect(city).toHaveValue('Hồ Chí Minh');
      await expect(ward).toHaveValue('Bến Thành');
    }
    searchResponse = 'success';
    await open('/addresses');
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await choose(ward, 'ben thanh', 'Bến Thành');
    await page.getByLabel('Số nhà, tên đường').fill('123 Nguyễn Trãi');
    await page.getByRole('button', { name: 'Tìm địa chỉ', exact: true }).click();
    await page.getByLabel('Số nhà, tên đường').fill('124 Nguyễn Trãi');
    await page.waitForTimeout(400);
    await expect(page.getByRole('list', { name: 'Kết quả tìm địa chỉ' })).toHaveCount(0);
    await expect(map).toHaveCount(0);
    console.log(`PASS explicit search: typing 0, double-click 1, ${directSearch ? 'direct numeric draft/confirm (no map adjustment)' : 'choice/draft/drag/confirm'}, all forms, numeric request payloads, reload, stale payloads, fail/empty manual fallback, cancelled stale response`);
    if (validatedSearch) console.log('PASS raw provider → backend normalization → UI: live city anomaly selectable with canonical label and real coordinate; outside area/wrong province/region/ward not selectable; manual fallback preserves selectors');
  }
  if (currentLocation) {
    addresses = [];
    await open('/addresses');
    await choose(city, 'ho chi minh', 'Hồ Chí Minh');
    await choose(ward, 'ben thanh', 'Bến Thành');
    await page.getByLabel('Số nhà, tên đường').fill('GPS error test');
    for (const [code, message] of [[1, 'Quyền vị trí đã bị từ chối.'], [2, 'Không lấy được vị trí thiết bị.'], [3, 'Lấy vị trí quá thời gian chờ.']]) {
      await page.evaluate((code) => Object.defineProperty(navigator, 'geolocation', { configurable: true,
        value: { getCurrentPosition(_success, failure) { failure({ code }); } },
      }), code);
      await page.getByRole('button', { name: 'Dùng vị trí hiện tại', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tìm địa chỉ', exact: true })).toBeEnabled();
      await openMap();
      await map.click({ position: { x: 100, y: 120 } });
      await confirm.click();
      await expect(city).toHaveValue('Hồ Chí Minh');
      await expect(ward).toHaveValue('Bến Thành');
    }
    await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true,
      value: { getCurrentPosition(success) { window.pendingGps = success; } },
    }));
    await page.getByRole('button', { name: 'Dùng vị trí hiện tại', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đang lấy vị trí...', exact: true })).toBeDisabled();
    await page.getByLabel('Số nhà, tên đường').fill('Changed during GPS');
    await page.evaluate(() => window.pendingGps({ coords: { latitude: 21, longitude: 105 }, timestamp: Date.now() }));
    await expect(map).toHaveCount(0);
    await expect(stale()).toBeVisible();
    await expect(selectedText()).toHaveText('Chưa chọn vị trí');
    // Closing an open picker fences a late device callback as well.
    await openMap();
    await page.getByRole('button', { name: 'Dùng vị trí hiện tại', exact: true }).click();
    await page.locator('section[aria-label^="Vị trí"]').getByRole('button', { name: 'Hủy', exact: true }).click();
    await page.evaluate(() => window.pendingGps({ coords: { latitude: 21, longitude: 105 }, timestamp: Date.now() }));
    await expect(map).toHaveCount(0);
    console.log('PASS GPS denied/unavailable/timeout: retry/search/manual preserved; loading; stale callback after address change/cancel ignored; no Driver endpoint calls');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS no page errors, no runtime third-party administrative/geocoding requests (mock API integration only)');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
