import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:5179/test/location-picker/index.html');
    await page.getByRole('button', { name: 'Chọn vị trí trên bản đồ' }).click();
    const map = page.locator('.leaflet-container');
    await map.click({ position: { x: 100, y: 100 } });
    const marker = page.locator('.leaflet-marker-draggable');
    await marker.waitFor();
    const box = await marker.boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 35, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Xác nhận vị trí' }).click();
    const first = JSON.parse(await page.locator('output').textContent());
    assert(Number.isFinite(first.latitude) && Number.isFinite(first.longitude));
    await page.getByRole('button', { name: 'Thay đổi vị trí' }).click();
    await map.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Xác nhận vị trí' }).click();
    const second = JSON.parse(await page.locator('output').textContent());
    assert.notDeepEqual(first, second);
    await page.getByRole('button', { name: 'Thay đổi vị trí' }).click();
    await map.click({ position: { x: 60, y: 60 } });
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('output').textContent()), second);
    assert.equal(await page.locator('input[type=number]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    console.log(
      `PASS ${size.width}x${size.height}: click, drag, confirm, keyboard, cancel, readonly, no overflow`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
