import { expect, request, test, type BrowserContext, type WebSocket } from './support/test.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  openRoleBrowser,
} from './support/browser-session.js';
import { createPhaseG3AFixture, type PhaseG3AFixtureValue } from './support/phase-g3a-fixture.js';

test.describe.serial('Phase G3A/G3B2 realtime line-haul browser flow', () => {
  let fixture: PhaseG3AFixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseG3AFixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('simulation reaches the authenticated API, Redis, Socket, and operational map', async ({
    browser,
  }) => {
    const pageErrors: string[] = [];
    const dispatcher = await openRoleBrowser({
      browser,
      actor: fixture.actors.dispatcher,
      expectedPath: '/dispatcher/dashboard',
      homeHeading: 'Dashboard điều phối',
      viewport: { width: 1440, height: 960 },
    });
    contexts.push(dispatcher.context);
    dispatcher.page.on('pageerror', (error) => pageErrors.push(error.message));
    const socketFrames: string[] = [];
    dispatcher.page.on('websocket', (socket: WebSocket) => {
      socket.on('framereceived', (event) => socketFrames.push(String(event.payload)));
      socket.on('framesent', (event) => socketFrames.push(String(event.payload)));
    });
    await dispatcher.page.goto('/dispatcher/line-haul/map');
    await expect(
      dispatcher.page.getByRole('heading', { level: 1, name: 'Bản đồ chuyến liên kho' }),
    ).toBeVisible();
    await expect(
      dispatcher.page
        .getByText(new RegExp(fixture.tripId))
        .or(dispatcher.page.getByText(/LHT-BG3A-/)),
    ).toBeVisible();
    await expect(dispatcher.page.locator('.leaflet-overlay-pane path[fill="none"]')).toHaveCount(1);
    await expect
      .poll(() => socketFrames.some((frame) => frame.includes('linehaul.trip.subscribe')))
      .toBe(true);

    const admin = await openRoleBrowser({
      browser,
      actor: fixture.actors.admin,
      expectedPath: '/admin/dashboard',
      homeHeading: 'Dashboard quản trị',
      viewport: { width: 1440, height: 960 },
    });
    contexts.push(admin.context);
    await admin.page.goto('/admin/line-haul/map');
    await expect(admin.page.getByRole('heading', { name: 'Bản đồ chuyến liên kho' })).toBeVisible();
    await expect(admin.page.getByText(fixture.tripCode)).toBeVisible();
    await expectNoHorizontalOverflow(admin.page);

    const warehouse = await openRoleBrowser({
      browser,
      actor: fixture.actors.destinationStaff,
      expectedPath: '/warehouse/workspace',
      homeHeading: fixture.destinationWarehouseName,
      viewport: { width: 1024, height: 768 },
    });
    contexts.push(warehouse.context);
    await warehouse.page.goto('/warehouse/line-haul/map');
    await expect(
      warehouse.page.getByRole('heading', { name: 'Bản đồ chuyến liên kho' }),
    ).toBeVisible();
    await expect(warehouse.page.getByText(fixture.tripCode)).toBeVisible();
    await expectNoHorizontalOverflow(warehouse.page);

    const driver = await openRoleBrowser({
      browser,
      actor: fixture.actors.driver,
      expectedPath: '/driver/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 375, height: 812 },
    });
    contexts.push(driver.context);
    await driver.page.goto('/driver/line-haul');
    await expect(
      driver.page.getByRole('heading', { level: 1, name: 'Chuyến liên kho đang chạy' }),
    ).toBeVisible();
    await expect(
      driver.page.getByRole('region', { name: 'GPS simulator development' }),
    ).toBeVisible();
    await expect(driver.page.locator('.leaflet-overlay-pane path[fill="none"]')).toHaveCount(1);
    await expectMinimumControlHeight(driver.page, 'Start', 48);
    await expectNoHorizontalOverflow(driver.page);

    await Promise.all([
      driver.page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/driver/line-haul/trips/${fixture.tripId}/location`) &&
          response.status() === 200,
      ),
      driver.page.getByRole('button', { name: 'Start' }).click(),
    ]);
    await expect
      .poll(
        () => socketFrames.filter((frame) => frame.includes('linehaul.location.updated')).length,
      )
      .toBeGreaterThanOrEqual(1);
    await expect(dispatcher.page.getByText(/Hiện tại · \d+ giây trước/)).toBeVisible();
    await expect(admin.page.getByText(/Hiện tại · \d+ giây trước/)).toBeVisible();
    await expect(warehouse.page.getByText(/Hiện tại · \d+ giây trước/)).toBeVisible();

    const tripDetail = await dispatcher.context.newPage();
    await tripDetail.goto(`/dispatcher/line-haul/${fixture.tripId}`);
    await expect(
      tripDetail.getByRole('heading', { name: 'Khoảng cách và thời gian tuyến' }),
    ).toBeVisible();
    await expect(tripDetail.getByText('Đang dùng tuyến v1.', { exact: true })).toBeVisible();
    await expect(tripDetail.locator('.leaflet-overlay-pane path[fill="none"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(tripDetail);

    await driver.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/driver/line-haul/trips/${fixture.tripId}/location`) &&
        response.status() === 200,
      { timeout: 10_000 },
    );
    await expect
      .poll(
        () => socketFrames.filter((frame) => frame.includes('linehaul.location.updated')).length,
      )
      .toBeGreaterThanOrEqual(2);

    await driver.page.getByRole('button', { name: 'Stop' }).click();

    const api = await request.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const driverLogin = await api.post('/api/v1/auth/login', {
      data: {
        email: fixture.actors.driver.email,
        password: fixture.actors.driver.password,
      },
    });
    expect(driverLogin.ok()).toBe(true);
    const driverLoginBody = (await driverLogin.json()) as { data: { accessToken: string } };
    const farPoint = { latitude: 10.9, longitude: 107.2 };
    for (let sample = 0; sample < 3; sample += 1) {
      const gps = await api.post(`/api/v1/driver/line-haul/trips/${fixture.tripId}/location`, {
        headers: { Authorization: `Bearer ${driverLoginBody.data.accessToken}` },
        data: farPoint,
      });
      expect(gps.ok()).toBe(true);
    }
    await expect(tripDetail.getByText('Lệch tuyến', { exact: true })).toBeVisible();
    await expect(dispatcher.page.getByText('Lệch tuyến', { exact: true })).toBeVisible();
    await expect(warehouse.page.getByText('Lệch tuyến', { exact: true })).toBeVisible();
    await expect(driver.page.getByText('Lệch tuyến', { exact: true })).toBeVisible();

    await tripDetail.getByRole('button', { name: 'Tính lại tuyến' }).click();
    const rerouteDialog = tripDetail.getByRole('dialog', { name: 'Xác nhận tính lại tuyến' });
    await expect(rerouteDialog).toBeVisible();
    // Keep the real GPS sample fresh after the cross-tab UI assertions.
    const currentGps = await api.post(`/api/v1/driver/line-haul/trips/${fixture.tripId}/location`, {
      headers: { Authorization: `Bearer ${driverLoginBody.data.accessToken}` },
      data: farPoint,
    });
    expect(currentGps.ok()).toBe(true);
    await Promise.all([
      tripDetail.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.tripId}/recalculate-route`) &&
          response.status() === 200,
      ),
      rerouteDialog.getByRole('button', { name: 'Tính lại tuyến' }).click(),
    ]);
    await expect(tripDetail.getByText('Đang dùng tuyến v2.', { exact: true })).toBeVisible();
    await expect(tripDetail.getByText(/v1 · Tuyến kế hoạch/)).toBeVisible();
    await expect(tripDetail.getByText(/v2 · Tuyến tính lại/)).toBeVisible();
    await expect(tripDetail.locator('.leaflet-overlay-pane path[fill="none"]')).toHaveCount(2);

    const onRouteGps = await api.post(`/api/v1/driver/line-haul/trips/${fixture.tripId}/location`, {
      headers: { Authorization: `Bearer ${driverLoginBody.data.accessToken}` },
      data: farPoint,
    });
    expect(onRouteGps.ok()).toBe(true);
    await expect(tripDetail.getByText('Đúng tuyến', { exact: true })).toBeVisible();
    await expect(driver.page.getByText('Đúng tuyến', { exact: true })).toBeVisible();

    const login = await api.post('/api/v1/auth/login', {
      data: {
        email: fixture.actors.destinationStaff.email,
        password: fixture.actors.destinationStaff.password,
      },
    });
    expect(login.ok()).toBe(true);
    const loginBody = (await login.json()) as { data: { accessToken: string } };
    const arrival = await api.post(`/api/v1/line-haul/trips/${fixture.tripId}/arrive`, {
      headers: { Authorization: `Bearer ${loginBody.data.accessToken}` },
    });
    expect(arrival.ok()).toBe(true);
    await api.dispose();

    await expect(
      dispatcher.page.getByRole('heading', { name: 'Không có chuyến liên kho đang chạy' }),
    ).toBeVisible();
    await expect(
      admin.page.getByRole('heading', { name: 'Không có chuyến liên kho đang chạy' }),
    ).toBeVisible();
    await expect(
      warehouse.page.getByRole('heading', { name: 'Không có chuyến liên kho đang chạy' }),
    ).toBeVisible();
    await expect(
      driver.page.getByRole('heading', { name: 'Chưa có chuyến liên kho active' }),
    ).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(dispatcher.page);
    expect(pageErrors).toEqual([]);
  });
});
