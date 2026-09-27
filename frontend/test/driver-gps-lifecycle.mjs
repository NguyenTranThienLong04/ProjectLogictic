import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Real App/routes/provider/auth, with explicit browser-GPS and HTTP fixtures.
// No staging/real Redis claim: backend TTL/eligibility have separate regressions.
const config = {
  logLevel: 'error',
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1'),
    'import.meta.env.VITE_LOCATION_MODE': JSON.stringify('REAL'),
  },
  build: { outDir: '.vite/driver-gps' },
  preview: { host: '127.0.0.1', port: 4194, strictPort: true },
};
process.env.NODE_ENV = 'production';
await build(config);
const server = await preview(config);
let browser;
try {
  browser = await chromium.launch();
  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    const errors = [],
      posts = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.gpsFixture = { mode: 'granted', acquisitions: 0, watches: 0 };
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition(success, failure) {
            window.gpsFixture.acquisitions++;
            if (window.gpsFixture.mode === 'pending') return;
            if (window.gpsFixture.mode === 'denied') {
              queueMicrotask(() => failure({ code: 1 }));
              return;
            }
            queueMicrotask(() =>
              success({ coords: { latitude: 10.775, longitude: 106.7 }, timestamp: Date.now() }),
            );
          },
          watchPosition() {
            window.gpsFixture.watches++;
            throw Error('Unexpected GPS watcher');
          },
        },
      });
    });
    const now = new Date('2026-09-27T08:00:00Z');
    const user = {
      id: 'gps-driver-user',
      email: 'gps@example.test',
      fullName: 'GPS Driver',
      phone: null,
      role: 'DRIVER',
      status: 'ACTIVE',
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    };
    const driver = {
      id: 'gps-driver',
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      employeeCode: 'GPS-TEST',
      vehicleType: 'MOTORBIKE',
      vehiclePlate: 'GPS-001',
      status: 'OFFLINE',
      isOnline: false,
      isAvailable: false,
      capabilities: ['PICKUP', 'DELIVERY'],
      operatingWarehouse: null,
      createdAt: now,
      updatedAt: now,
    };
    let loggedIn = false,
      currentLocation = null,
      writeFailure = false;
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let data;
      if (path.endsWith('/auth/login')) {
        loggedIn = true;
        data = { user, accessToken: 'fixture-token', expiresIn: 3600 };
      } else if (path.endsWith('/auth/refresh')) {
        if (!loggedIn) {
          await route.fulfill({ status: 401, json: { message: 'Guest' } });
          return;
        }
        data = { user, accessToken: 'fixture-token', expiresIn: 3600 };
      } else if (path.endsWith('/auth/logout')) {
        loggedIn = false;
        data = null;
      } else if (path.endsWith('/drivers/me/availability')) {
        driver.isOnline = request.postDataJSON().isOnline;
        driver.isAvailable = driver.isOnline;
        driver.status = driver.isOnline ? 'AVAILABLE' : 'OFFLINE';
        data = driver;
      } else if (path.endsWith('/drivers/me')) data = driver;
      else if (path.endsWith('/users/me')) data = user;
      else if (path.endsWith('/line-haul/active-trip')) data = null;
      else if (path.endsWith('/driver/assignments/gps-task')) {
        await route.fulfill({ status: 404, json: { message: 'Task fixture unavailable' } });
        return;
      } else if (path.endsWith('/driver/location')) {
        if (request.method() === 'POST') {
          assert.equal(request.headers().authorization, 'Bearer fixture-token');
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ['latitude', 'longitude']);
          posts.push({ ...body, at: await page.evaluate(() => Date.now()) });
          if (writeFailure) {
            await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
            return;
          }
          currentLocation = {
            ...body,
            driverId: driver.id,
            updatedAt: new Date(posts.at(-1).at).toISOString(),
          };
        }
        data = currentLocation;
      } else if (path.endsWith('/dashboards/driver'))
        data = {
          generatedAt: now,
          driver,
          overview: {
            totalShipments: 0,
            pending: 0,
            inTransit: 0,
            outForDelivery: 0,
            delivered: 0,
            failed: 0,
            cancelled: 0,
            deliverySuccessRate: 0,
            averageDeliveryTimeHours: 0,
            codCollected: 0,
            codUnsettled: 0,
          },
          assignments: { pending: 0, active: 0, completed: 0 },
          recentTasks: [],
        };
      else data = { items: [], total: 0, page: 1, totalPages: 1, unreadCount: 0 };
      await route.fulfill({ json: { data, meta: {} } });
    });
    await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
    await page.goto('http://127.0.0.1:4194/login');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('FixturePassword123!');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Bắt đầu nhận việc' })).toBeVisible();
    await page.clock.install({ time: now });
    assert.equal(posts.length, 0);
    await page.getByRole('button', { name: 'Bắt đầu nhận việc' }).click();
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();
    assert.equal(posts.length, 1);
    assert.ok(page.url().endsWith('/driver/dashboard'));
    const tick = async () => {
      const before = posts.length;
      await page.clock.runFor(5_000);
      await expect.poll(() => posts.length).toBe(before + 1);
    };
    await tick();
    for (const name of [
      'Lấy hàng',
      'Hồ sơ',
      'Giao hàng',
      'Lịch sử',
      'Bản đồ',
      'Dashboard',
      'Bản đồ',
      'Hồ sơ',
    ]) {
      const before = posts.length;
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();
      assert.equal(posts.length, before, `navigation to ${name} must not publish`);
      await tick();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `overflow at ${size.width}`,
      );
    }
    for (let i = 1; i < posts.length; i++) {
      const interval = posts[i].at - posts[i - 1].at;
      assert.ok(
        interval >= 4_000 && interval <= 6_000,
        `5s cadence with browser scheduling tolerance: ${interval}`,
      );
    }
    assert.equal(await page.evaluate(() => window.gpsFixture.watches), 0);
    // Deep task route uses the same mounted workspace even on a task read error.
    await page.evaluate(() => {
      history.pushState({}, '', '/driver/pickups/gps-task');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'Chi tiết lấy hàng' })).toBeVisible();
    await tick();
    driver.status = 'BUSY';
    driver.isAvailable = false;
    await tick();
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();
    driver.status = 'AVAILABLE';
    driver.isAvailable = true;

    // A frozen geolocation request expires UI current state without reposting a cached point.
    await page.evaluate(() => {
      window.gpsFixture.mode = 'pending';
    });
    const freshCount = posts.length;
    await page.clock.runFor(20_000);
    await expect(page.getByText('GPS đã mất/stale', { exact: true })).toBeVisible();
    assert.equal(posts.length, freshCount);
    await page.evaluate(() => {
      window.gpsFixture.mode = 'granted';
    });
    await page.getByRole('button', { name: 'Thử lại GPS' }).click();
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Chuyển offline' }).click();
    await expect(page.getByText('GPS đã dừng', { exact: true })).toBeVisible();
    const offlineCount = posts.length,
      offlineAcquisitions = await page.evaluate(() => window.gpsFixture.acquisitions);
    await page.clock.runFor(25_000);
    assert.equal(posts.length, offlineCount);
    assert.equal(await page.evaluate(() => window.gpsFixture.acquisitions), offlineAcquisitions);

    await page.evaluate(() => {
      window.gpsFixture.mode = 'denied';
    });
    await page.getByRole('button', { name: 'Bắt đầu nhận việc' }).click();
    await expect(page.getByText('Quyền vị trí bị từ chối', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Bạn cần bật quyền vị trí để nhận nhiệm vụ.', { exact: true }),
    ).toBeVisible();
    await page.clock.runFor(25_000);
    assert.equal(posts.length, offlineCount);
    await page.evaluate(() => {
      window.gpsFixture.mode = 'granted';
    });
    await page.getByRole('button', { name: 'Thử lại GPS' }).click();
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();

    writeFailure = true;
    await tick();
    await expect(page.getByText('GPS đã mất/stale', { exact: true })).toBeVisible();
    writeFailure = false;
    await page.clock.runFor(5_000);
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();

    driver.status = 'SUSPENDED';
    driver.isOnline = false;
    await page.clock.runFor(5_000);
    await expect(page.getByText('GPS đã dừng', { exact: true })).toBeVisible();
    const suspendedCount = posts.length;
    await page.clock.runFor(25_000);
    assert.equal(posts.length, suspendedCount);
    driver.status = 'AVAILABLE';
    driver.isOnline = true;
    await page.clock.runFor(5_000);
    await expect(page.getByText('GPS đang hoạt động', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
    const logoutCount = posts.length;
    await page.clock.runFor(25_000);
    assert.equal(posts.length, logoutCount);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${size.width}x${size.height}: login/online without Map, route persistence, 5s cadence, no duplicates, stale/recovery, offline, denied/retry, suspension, logout`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
