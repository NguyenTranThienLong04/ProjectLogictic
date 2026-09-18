import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  build: {
    outDir: '.vite/location-viewport',
    rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
  preview: { host: '127.0.0.1', port: 4190, strictPort: true },
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
  const map = page.locator('.leaflet-container');
  const confirm = page.getByRole('button', { name: 'Xác nhận vị trí' });
  const marker = page.locator('.leaflet-marker-draggable');
  const draft = page.locator('section > p[role="status"]').last();
  const readDraft = async () => (await draft.textContent()).split(',').map(Number);
  const center = async () => {
    await map.focus();
    await page.keyboard.press('Enter');
    return readDraft();
  };
  const near = (actual, expected) => actual.forEach((n, i) => assert(Math.abs(n - expected[i]) < 0.002, `${actual} != ${expected}`));
  const open = async (params = {}) => {
    await page.goto(`http://127.0.0.1:4190/test/location-picker/index.html?${new URLSearchParams({ ...params, viewport: '1' })}`);
    await page.getByRole('button', { name: /Chọn vị trí trên bản đồ|Thay đổi vị trí/ }).click();
    await expect(map).toBeVisible();
  };
  const zoom = async (value) => {
    await expect.poll(async () => page.locator(`.leaflet-tile[src*=".openstreetmap.org/${value}/"]`).count()).toBeGreaterThan(0);
  };

  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    for (const [params, expected, level] of [
      [{ city: 'Ho Chi Minh City' }, [10.993, 106.638], 12],
      [{ city: 'TP. Hồ Chí Minh' }, [10.993, 106.638], 12],
      [{ city: 'Hà Nội' }, [21, 105.698], 12],
      [{ city: 'Hồ Chí Minh', ward: 'Bến Thành' }, [10.77, 106.695], 15],
      [{}, [16, 106], 6],
      [{ city: 'Unknown' }, [16, 106], 6],
    ]) {
      await open(params);
      await zoom(level);
      await expect(confirm).toBeDisabled();
      await expect(marker).toHaveCount(0);
      assert.equal(await page.locator('output').textContent(), '');
      near(await center(), expected);
    }
    console.log(`PASS ${size.width}x${size.height}: city/full address focus, Hanoi, Vietnam, no automatic selection`);

    // Saved coordinates override contradictory city text, with a centered marker and close zoom.
    await open({ lat: '21.0285', lng: '105.8542', city: 'Ho Chi Minh City' });
    await zoom(16);
    await expect(marker).toHaveCount(1);
    // Read both rectangles together: tile-status text can settle between two tool calls.
    await expect.poll(() => page.evaluate(() => {
      const mapBox = document.querySelector('.leaflet-container').getBoundingClientRect();
      const markerBox = document.querySelector('.leaflet-marker-draggable').getBoundingClientRect();
      return Math.max(Math.abs(markerBox.x + markerBox.width / 2 - mapBox.x - mapBox.width / 2),
        Math.abs(markerBox.y + markerBox.height / 2 - mapBox.y - mapBox.height / 2));
    })).toBeLessThan(2);
    near(await center(), [21.0285, 105.8542]);
    await map.click({ position: { x: 100, y: 100 } });
    await expect(confirm).toBeEnabled();
    const clicked = await readDraft();
    const box = await marker.boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 48, box.y + 42, { steps: 8 });
    await page.mouse.up();
    const dragged = await readDraft();
    assert.notDeepEqual(dragged, clicked);
    await confirm.click();
    const saved = JSON.parse(await page.locator('output').textContent());
    near([saved.latitude, saved.longitude], dragged);
    await page.getByRole('button', { name: 'Thay đổi vị trí' }).click();
    await zoom(16);
    near(await center(), dragged);

    await map.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await zoom(17);
    const panned = await center();
    assert.notDeepEqual(panned, dragged);
    await page.getByRole('textbox', { name: 'Thành phố' }).fill(' ho chi minh city ');
    near(await center(), panned);
    await zoom(17);
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('output').textContent()), saved);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS ${size.width}x${size.height}: saved priority, marker, click/drag/confirm/reopen, pan/zoom/context rerender, cancel, no overflow`);
  }

  for (const invalid of [{ lat: 'NaN', lng: '106' }, { lat: 'Infinity', lng: '106' }, { lat: '91', lng: '106' }, { lat: '10', lng: '181' }, { lat: '10' }, { lng: '106' }]) {
    await open({ ...invalid, city: 'Ho Chi Minh City' });
    await expect(confirm).toBeDisabled();
    await expect(marker).toHaveCount(0);
    await zoom(12);
    near(await center(), [10.993, 106.638]);
  }
  await open({ lat: 'Infinity', lng: '0' });
  await zoom(6);
  near(await center(), [16, 106]);
  assert.deepEqual(errors, []);
  console.log('PASS invalid/partial initial coordinates: city/Vietnam fallback, no crash');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
