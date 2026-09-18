import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// --offline exercises tile events with a test image, never claims provider availability.
// --production serves a compiled picker fixture using the application's Vite config.
const offline = process.argv.includes('--offline');
let server;
let url = process.env.PICKER_TEST_URL ?? 'http://127.0.0.1:5179/test/location-picker/index.html';
if (process.argv.includes('--production')) {
  const { build, preview } = await import('vite');
  const config = {
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    build: {
      outDir: '.vite/location-picker',
      rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
    },
    preview: { host: '127.0.0.1', port: 4189, strictPort: true },
  };
  await build(config);
  server = await preview(config);
  url = 'http://127.0.0.1:4189/test/location-picker/index.html';
}

const browser = await chromium.launch();
const failures = [];
const responses = [];
const violations = [];
try {
  const page = await browser.newPage();
  page.on('requestfailed', (request) => {
    if (request.url().includes('tile.openstreetmap.org')) {
      failures.push({ url: request.url(), error: request.failure()?.errorText });
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('tile.openstreetmap.org')) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });
  page.on('console', (message) => {
    if (/content security policy|mixed content/i.test(message.text())) violations.push(message.text());
  });
  for (const mode of ['live', 'one-failure', 'all-fail']) {
    let count = 0;
    let failAll = mode === 'all-fail';
    await page.unrouteAll();
    if (offline || mode === 'one-failure' || mode === 'all-fail') {
      await page.route('https://*.tile.openstreetmap.org/**', (route) => {
        count += 1;
        if (failAll || (mode === 'one-failure' && count === 1)) return route.abort();
        return offline
          ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dbeafe"/></svg>' })
          : route.continue();
      });
    }
    await page.goto(url);
    if (mode === 'live') {
      await page.getByRole('button', { name: 'Chọn vị trí trên bản đồ' }).click();
      await page.locator('.leaflet-container').click({ position: { x: 100, y: 100 } });
      await page.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(page.locator('output')).toBeEmpty();
      await expect(page.getByText('Chưa chọn vị trí', { exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Chọn vị trí trên bản đồ' }).click();
    const map = page.locator('.leaflet-container');
    if (mode === 'all-fail') {
      await expect(page.getByText('Không tải được bản đồ.', { exact: false })).toBeVisible();
    } else {
      await expect(map.locator('img.leaflet-tile-loaded').first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Không tải được bản đồ.', { exact: false })).toHaveCount(0);
      await expect(page.getByText('Đang tải bản đồ…')).toHaveCount(0);
      if (mode === 'one-failure') {
        await expect(page.getByText('Một phần bản đồ chưa tải được.', { exact: false })).toBeVisible();
      }
    }
    await map.click({ position: { x: 100, y: 100 } });
    const marker = page.locator('.leaflet-marker-draggable');
    await expect(marker).toBeVisible();
    const draft = page.locator('section p[role="status"]').last();
    const before = await draft.textContent();
    const box = await marker.boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 45, { steps: 6 });
    await page.mouse.up();
    await expect(draft).not.toHaveText(before);
    const [latitude, longitude] = (await draft.textContent()).split(',').map(Number);
    assert(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90);
    assert(Number.isFinite(longitude) && longitude >= -180 && longitude <= 180);
    await page.getByRole('button', { name: 'Xác nhận vị trí' }).click();
    const coordinate = JSON.parse(await page.locator('output').textContent());
    assert.deepEqual(coordinate, { latitude, longitude });
    await expect(map).toHaveCount(0);
    await expect(page.locator('section > p[aria-live]')).toHaveText(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
    await expect(page.locator('input')).toHaveCount(0);
    await page.getByRole('button', { name: 'Thay đổi vị trí' }).click();
    await expect(marker).toBeVisible();
    await expect(draft).toHaveText(`${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`);
    const mapBox = await map.boundingBox();
    const reopenedMarker = await marker.boundingBox();
    assert(Math.abs(reopenedMarker.x + reopenedMarker.width / 2 - (mapBox.x + mapBox.width / 2)) <= 2);
    assert(Math.abs(reopenedMarker.y + reopenedMarker.height / 2 - (mapBox.y + mapBox.height / 2)) <= 2);
    if (mode === 'all-fail') {
      await expect(page.getByText('Không tải được bản đồ.', { exact: false })).toBeVisible();
      failAll = false;
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(map.locator('img.leaflet-tile-loaded').first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Không tải được bản đồ.', { exact: false })).toHaveCount(0);
      await expect(page.getByText('Đang tải bản đồ…')).toHaveCount(0);
      console.log(`PASS ${offline ? 'TEST IMAGE' : 'NETWORK'} recovery in same map after zoom`);
    }
    await map.click({ position: { x: 60, y: 60 } });
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('output').textContent()), coordinate);
    await page.getByRole('button', { name: 'Thay đổi vị trí' }).click();
    await map.click({ position: { x: 90, y: 90 } });
    const [newLatitude, newLongitude] = (await draft.textContent()).split(',').map(Number);
    await page.getByRole('button', { name: 'Xác nhận vị trí' }).click();
    const changed = JSON.parse(await page.locator('output').textContent());
    assert.deepEqual(changed, { latitude: newLatitude, longitude: newLongitude });
    assert.notDeepEqual(changed, coordinate);
    console.log(`PASS ${offline ? 'TEST IMAGE' : 'NETWORK'} ${mode}: tile state, click, drag updates coordinate, confirm, reopen, cancel`);
  }
  assert.equal(violations.length, 0);
  assert(responses.some((response) => response.status === 200));
} finally {
  console.log(JSON.stringify({ source: offline ? 'intercepted test images (not provider evidence)' : 'real network', responses: responses.slice(0, 8), failures: failures.slice(0, 4), violations }, null, 2));
  await browser.close();
  await new Promise((resolve, reject) => server ? server.httpServer.close((error) => error ? reject(error) : resolve()) : resolve());
}
