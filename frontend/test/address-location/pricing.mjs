// Production Pricing page with intercepted HTTP; real API/DB coverage is separate.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {
  root, configFile: `${root}/vite.config.ts`,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/pricing', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4195, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const policy = { baseFee: 30000, includedWeightGrams: 1000, extraWeightFeePerKg: 5000, codFeeBasisPoints: 50 };
  let active, failure, posts = 0, holdGet, holdPost, rejectSave = false;
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    if (new URL(req.url()).pathname.endsWith('/pricing/config')) {
      if (req.method() === 'POST') {
        posts++;
        assert.deepEqual(req.postDataJSON(), policy);
        if (holdPost) await holdPost;
        if (rejectSave) return route.fulfill({ status: 409, json: { code: 'PRICING_CONFIG_CONFLICT', message: 'Bảng giá đã thay đổi. Vui lòng thử lại.' } });
        active = { id: 'test-pricing', ...policy, version: 1, isActive: true, distanceFee: 0, surcharge: 0, discount: 0, createdAt: '2026-09-26T00:00:00Z' };
        return route.fulfill({ status: 201, json: { data: active, meta: {} } });
      }
      if (holdGet) await holdGet;
      if (failure === 'network') return route.abort('failed');
      if (failure) return route.fulfill({ status: failure.status, json: { code: failure.code, message: 'Internal server error' } });
      if (!active) return route.fulfill({ status: 503, json: { code: 'PRICING_CONFIG_UNAVAILABLE', message: 'Chưa có cấu hình giá vận chuyển đang hoạt động.' } });
      return route.fulfill({ json: { data: active, meta: {} } });
    }
    return route.fulfill({ json: { data: { items: [], unreadCount: 0, total: 0, page: 1, totalPages: 0 }, meta: {} } });
  });
  const visit = () => page.goto('http://127.0.0.1:4195/test/address-location/index.html?screen=/admin/pricing');
  const bootstrap = page.getByRole('heading', { name: 'Chưa có cấu hình giá vận chuyển', exact: true });
  const create = page.getByRole('button', { name: 'Tạo cấu hình giá', exact: true });
  const save = page.getByRole('button', { name: 'Lưu và kích hoạt', exact: true });
  const base = page.getByLabel('Phí cơ bản', { exact: true });
  const weight = page.getByLabel('Khối lượng đã bao gồm (gram)', { exact: true });
  const cod = page.getByLabel('Phí COD (basis points)', { exact: true });
  await mkdir('test-results/pricing-bootstrap', { recursive: true });
  for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    active = undefined; failure = undefined; posts = 0;
    await page.setViewportSize(size);
    let release;
    holdGet = new Promise(resolve => { release = resolve; });
    await visit();
    await expect(page.getByText('Đang tải cấu hình giá', { exact: true })).toBeVisible();
    release(); holdGet = undefined;
    await expect(bootstrap).toBeVisible();
    await expect(page.getByText('Internal server error', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Hệ thống chưa thể tính phí vận chuyển vì Admin/)).toBeVisible();
    assert.equal(posts, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `test-results/pricing-bootstrap/empty-${size.width}.png`, fullPage: true });
    await create.click();
    await expect(base).toBeFocused();
    await expect(base).toHaveValue('30000');
    await expect(weight).toHaveValue('1000');
    await expect(page.getByLabel('Phí mỗi kg vượt mức', { exact: true })).toHaveValue('5000');
    await expect(cod).toHaveValue('50');
    await expect(page.getByText(/50 basis points = 0,5%/)).toBeVisible();
    await expect(page.getByText(/Phí khoảng cách: 0 VND/)).toBeVisible();
    assert.equal(posts, 0, 'CTA only opens a draft, never seeds');
    await base.fill('-1'); await weight.fill('0'); await cod.fill('10001');
    await save.click();
    await expect(base).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Phí không được âm.', { exact: true })).toBeVisible();
    await expect(page.getByText('Khối lượng tối thiểu 1 gram.', { exact: true })).toBeVisible();
    await expect(page.getByText('Phí COD tối đa 10.000 basis points (100%).', { exact: true })).toBeVisible();
    assert.equal(posts, 0);
    await base.fill('30000'); await weight.fill('1000'); await cod.fill('50');
    rejectSave = true;
    let releasePost;
    holdPost = new Promise(resolve => { releasePost = resolve; });
    await save.click();
    try { await expect(save).toBeDisabled(); } catch (error) {
      console.log({ width: size.width, posts, form: await page.locator('form').innerText(), values: await page.locator('form input').evaluateAll(inputs => inputs.map(input => ({ id: input.id, value: input.value }))) });
      await page.screenshot({ path: 'test-results/pricing-bootstrap/submit-failure.png', fullPage: true });
      throw error;
    }
    releasePost(); holdPost = undefined;
    await expect(page.getByText('Bảng giá đã thay đổi. Vui lòng thử lại.', { exact: true })).toBeVisible();
    await expect(base).toHaveValue('30000');
    rejectSave = false;
    await save.click();
    await expect(page.getByText('Đã kích hoạt bảng giá phiên bản 1.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đang hoạt động', exact: true })).toBeVisible();
    assert.equal(posts, 2);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Đang hoạt động', exact: true })).toBeVisible();
    await expect(base).toHaveValue('30000');
    await expect(create).toHaveCount(0);
    assert.equal(posts, 2, 'Reload must not activate another version');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `test-results/pricing-bootstrap/active-${size.width}.png`, fullPage: true });
    console.log(`PASS bootstrap/draft/validation/save feedback/reload at ${size.width}x${size.height}`);
  }
  for (const problem of ['network', { status: 503, code: 'INTERNAL_SERVER_ERROR' }, { status: 500, code: 'PRICING_CONFIG_UNAVAILABLE' }]) {
    failure = problem;
    await visit();
    await expect(page.getByRole('heading', { name: 'Không thể tải cấu hình giá', exact: true })).toBeVisible();
    await expect(create).toHaveCount(0);
    await expect(bootstrap).toHaveCount(0);
    failure = undefined;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đang hoạt động', exact: true })).toBeVisible();
  }
  assert.deepEqual(errors, []);
  console.log('PASS real errors remain retryable errors; no bootstrap misclassification, no page errors. HTTP mocked, not staging.');
} finally {
  await browser?.close();
  await server.close();
}
