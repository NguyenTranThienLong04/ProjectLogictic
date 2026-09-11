import { expect, test, type BrowserContext, type Locator, type Page } from './support/test.js';
import { PhaseFApiClient } from './support/api-client.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  expectSessionAfterReload,
  openRoleBrowser,
  type RoleBrowserSession,
} from './support/browser-session.js';
import {
  createShipmentThroughBrowser,
  runDestinationWarehouseFlow,
  runOriginWarehouseFlow,
  waitForShipmentStatus,
} from './support/journey-helpers.js';
import { PhaseFFixture } from './support/phase-f-fixture.js';

test.describe('Phase F browser-driven operational validation', () => {
  let fixture: PhaseFFixture | undefined;

  test.beforeAll(async () => {
    fixture = await PhaseFFixture.create();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test('completes the full multi-role journey with real Redis, Socket, maps, and RBAC', async ({
    browser,
  }) => {
    if (!fixture) throw new Error('Phase F fixture is unavailable');
    const api = await PhaseFApiClient.create();
    const sessions: RoleBrowserSession[] = [];
    const heartbeatStops: Array<() => Promise<void>> = [];
    const register = (session: RoleBrowserSession): RoleBrowserSession => {
      sessions.push(session);
      return session;
    };

    try {
      const staleSentAt = Date.now();
      await Promise.all([
        api.updateDriverLocation(fixture.actors.pickupStaleGps, 10.7759, 106.7007),
        api.updateDriverLocation(fixture.actors.deliveryStaleGps, 10.7863, 106.7042),
      ]);

      const customer = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.customer,
          expectedPath: '/dashboard',
          homeHeading: 'Dashboard',
          viewport: { width: 1440, height: 900 },
        }),
      );
      await expectSessionAfterReload(customer.page, '/dashboard', 'Dashboard');
      await expectNoHorizontalOverflow(customer.page);

      const pickupDriver = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.pickupNear,
          expectedPath: '/driver/dashboard',
          homeHeading: 'Dashboard',
          viewport: { width: 390, height: 844 },
        }),
      );
      await expectSessionAfterReload(pickupDriver.page, '/driver/dashboard', 'Dashboard');
      await startLocationSimulation(pickupDriver.page);
      await expectMinimumControlHeight(pickupDriver.page, 'Start');
      await expectNoHorizontalOverflow(pickupDriver.page);

      const shipment = await createShipmentThroughBrowser(customer.page, fixture);
      await expectNoHorizontalOverflow(customer.page);
      await api.expectCustomerLocationStatus(fixture.actors.customer, shipment.id, 404);

      await customer.page.goto('/dispatcher/pickups');
      await expect(customer.page).toHaveURL(/\/dashboard$/);
      await expect(
        customer.page.getByRole('heading', { level: 1, name: 'Dashboard' }),
      ).toBeVisible();
      await api.expectForbiddenShipmentRead(fixture.actors.customer, shipment.id);
      await customer.page.goto(`/shipments/${shipment.id}`);
      await expect(
        customer.page.getByRole('heading', { name: 'Tài xế đang giao hàng' }),
      ).toHaveCount(0);

      await expect
        .poll(() => Date.now() - staleSentAt, { timeout: 30_000, intervals: [500] })
        .toBeGreaterThan(20_500);
      const [stopPickupFarGps, stopPickupWrongAreaGps] = await Promise.all([
        api.startDriverLocationHeartbeat(fixture.actors.pickupFar, 10.92, 106.82),
        api.startDriverLocationHeartbeat(fixture.actors.pickupWrongArea, 10.776, 106.7008),
      ]);
      heartbeatStops.push(stopPickupFarGps, stopPickupWrongAreaGps);

      const dispatcher = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.dispatcher,
          expectedPath: '/dispatcher/dashboard',
          homeHeading: 'Dashboard điều phối',
          viewport: { width: 1440, height: 900 },
        }),
      );
      await expectSessionAfterReload(
        dispatcher.page,
        '/dispatcher/dashboard',
        'Dashboard điều phối',
      );
      await dispatcher.page.getByRole('link', { name: 'Lấy hàng', exact: true }).click();
      await expect(
        dispatcher.page.getByRole('heading', { name: 'Điều phối lấy hàng' }),
      ).toBeVisible();
      await dispatcher.page.getByLabel('Tìm vận đơn hoặc khách hàng').fill(shipment.trackingCode);
      let shipmentCard = dispatcher.page.locator('li', { hasText: shipment.trackingCode });
      await expect(shipmentCard).toBeVisible();
      await shipmentCard.getByRole('button', { name: 'Xác nhận vận đơn' }).click();
      await expect(
        dispatcher.page.getByText('Đã xác nhận và đưa vận đơn vào hàng chờ phân công.'),
      ).toBeVisible();
      await expect(shipmentCard.getByText('Chờ phân công lấy hàng', { exact: true })).toBeVisible();

      // Confirm can legitimately approach the backend's transaction timeout on
      // hosted Postgres. Refresh one-shot drivers only after that mutation so
      // their real Redis locations remain inside the canonical 20-second TTL.
      await Promise.all([
        api.updateDriverLocation(fixture.actors.pickupFar, 10.92, 106.82),
        api.updateDriverLocation(fixture.actors.pickupWrongArea, 10.776, 106.7008),
      ]);

      const pickupCandidates = shipmentCard.getByLabel('Tài xế lấy hàng');
      await expect(pickupCandidates).toBeEnabled();
      await expectCandidateEligibility(pickupCandidates, {
        included: [fixture.actors.pickupNear.fullName, fixture.actors.pickupFar.fullName],
        excluded: [
          fixture.actors.pickupWrongArea.fullName,
          fixture.actors.pickupNoGps.fullName,
          fixture.actors.pickupStaleGps.fullName,
        ],
      });
      await expectCandidateRanking(
        pickupCandidates,
        fixture.actors.pickupNear.fullName,
        fixture.actors.pickupFar.fullName,
      );
      await expect(shipmentCard.getByText(/đường bộ/).first()).toBeAttached();
      await expect(shipmentCard.getByText(/thiếu hoặc stale GPS/)).toBeVisible();
      await expect(shipmentCard.getByText(/không phù hợp khu vực/)).toBeVisible();
      await Promise.all([stopPickupFarGps(), stopPickupWrongAreaGps()]);
      await pickupCandidates.selectOption(fixture.driverIds.pickupNear);
      await shipmentCard.getByRole('button', { name: 'Phân công tài xế' }).click();
      await expect(dispatcher.page.getByText('Đã phân công tài xế lấy hàng.')).toBeVisible();
      await expectNoHorizontalOverflow(dispatcher.page);

      await pickupDriver.page.getByRole('link', { name: 'Lấy hàng', exact: true }).click();
      const pickupRow = pickupDriver.page.locator('tr', { hasText: shipment.trackingCode });
      await expect(pickupRow).toBeVisible();
      await pickupRow.getByRole('link', { name: 'Mở chi tiết' }).click();
      await expect(
        pickupDriver.page.getByRole('heading', { name: 'Bản đồ đến người gửi' }),
      ).toBeVisible();
      const pickupMap = pickupDriver.page.getByRole('region', {
        name: 'Bản đồ đến người gửi: vị trí tài xế và điểm đến được phép',
      });
      await expect(pickupMap).toBeVisible();
      await expect(pickupMap.locator('path.leaflet-interactive')).toHaveCount(2);
      const pickupLegend = pickupDriver.page.getByRole('list', { name: 'Chú thích bản đồ' });
      await expect(pickupLegend.getByText('Vị trí GPS hiện tại của bạn')).toBeVisible();
      await expect(pickupLegend.getByText('Người gửi Phase F')).toBeVisible();
      await expectMinimumControlHeight(pickupDriver.page, 'Nhận nhiệm vụ');
      await pickupDriver.page.getByRole('button', { name: 'Nhận nhiệm vụ' }).click();
      await expect(pickupDriver.page.getByText('Đã nhận nhiệm vụ lấy hàng.')).toBeVisible();
      await expect(pickupDriver.page.getByText('Đang lấy hàng', { exact: true })).toBeVisible();
      await pickupDriver.page
        .getByLabel('Ghi chú proof (tùy chọn)')
        .fill('Đã nhận kiện nguyên vẹn');
      await pickupDriver.page.getByRole('button', { name: 'Xác nhận đã lấy hàng' }).click();
      await expect(
        pickupDriver.page.getByText('Đã xác nhận lấy hàng và tạo pickup proof.'),
      ).toBeVisible();
      await expect(
        pickupDriver.page.getByRole('heading', { name: 'Pickup proof đã ghi nhận' }),
      ).toBeVisible();
      await pickupDriver.page.getByRole('button', { name: 'Stop' }).click();
      await expectNoHorizontalOverflow(pickupDriver.page);

      const destinationWarehouse = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.destinationStaff,
          expectedPath: '/warehouse/workspace',
          homeHeading: fixture.warehouseNames.destination,
          viewport: { width: 1440, height: 900 },
        }),
      );
      await expectSessionAfterReload(
        destinationWarehouse.page,
        '/warehouse/workspace',
        fixture.warehouseNames.destination,
      );
      await destinationWarehouse.page
        .getByLabel('Mã vận đơn hoặc mã vạch')
        .fill(shipment.trackingCode);
      await destinationWarehouse.page.getByRole('button', { name: 'Tra cứu kiện' }).click();
      await expect(destinationWarehouse.page.getByRole('alert')).toBeVisible();
      await expect(destinationWarehouse.page.getByRole('dialog')).toHaveCount(0);

      const originWarehouse = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.originStaff,
          expectedPath: '/warehouse/workspace',
          homeHeading: fixture.warehouseNames.origin,
          viewport: { width: 1440, height: 900 },
        }),
      );
      await expectSessionAfterReload(
        originWarehouse.page,
        '/warehouse/workspace',
        fixture.warehouseNames.origin,
      );
      await runOriginWarehouseFlow(
        originWarehouse.page,
        shipment.trackingCode,
        fixture.warehouseNames.destination,
      );
      await expectNoHorizontalOverflow(originWarehouse.page);

      await destinationWarehouse.page.reload();
      await runDestinationWarehouseFlow(destinationWarehouse.page, shipment.trackingCode);
      await expectNoHorizontalOverflow(destinationWarehouse.page);

      const deliveryDriver = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.deliveryNear,
          expectedPath: '/driver/dashboard',
          homeHeading: 'Dashboard',
          viewport: { width: 390, height: 844 },
        }),
      );
      const deliverySocketFrames: string[] = [];
      observeSocketFrames(deliveryDriver.page, deliverySocketFrames);
      await expectSessionAfterReload(deliveryDriver.page, '/driver/dashboard', 'Dashboard');
      await deliveryDriver.page.getByRole('link', { name: 'Giao hàng', exact: true }).click();
      await expect(deliveryDriver.page.getByText('Chưa có nhiệm vụ giao hàng')).toBeVisible();
      await deliveryDriver.page.getByRole('link', { name: 'Dashboard', exact: true }).click();
      await startLocationSimulation(deliveryDriver.page);
      await expectNoHorizontalOverflow(deliveryDriver.page);

      await dispatcher.page.getByRole('link', { name: 'Giao hàng', exact: true }).click();
      await expect(
        dispatcher.page.getByRole('heading', { name: 'Điều phối giao hàng' }),
      ).toBeVisible();
      shipmentCard = dispatcher.page.locator('li', { hasText: shipment.trackingCode });
      await expect(shipmentCard).toBeVisible();
      const [stopDeliveryFarGps, stopPickupOutsideDeliveryAreaGps] = await Promise.all([
        api.startDriverLocationHeartbeat(fixture.actors.deliveryFar, 10.93, 106.84),
        api.startDriverLocationHeartbeat(fixture.actors.pickupNear, 10.7861, 106.704),
      ]);
      heartbeatStops.push(stopDeliveryFarGps, stopPickupOutsideDeliveryAreaGps);
      const deliveryCandidates = shipmentCard.getByLabel('Tài xế giao hàng');
      await expect(deliveryCandidates).toBeEnabled();
      await expectCandidateEligibility(deliveryCandidates, {
        included: [fixture.actors.deliveryNear.fullName, fixture.actors.deliveryFar.fullName],
        excluded: [
          fixture.actors.pickupNear.fullName,
          fixture.actors.deliveryNoGps.fullName,
          fixture.actors.deliveryStaleGps.fullName,
        ],
      });
      await expectCandidateRanking(
        deliveryCandidates,
        fixture.actors.deliveryNear.fullName,
        fixture.actors.deliveryFar.fullName,
      );
      await Promise.all([stopDeliveryFarGps(), stopPickupOutsideDeliveryAreaGps()]);
      await deliveryCandidates.selectOption(fixture.driverIds.deliveryNear);
      await shipmentCard.getByRole('button', { name: 'Phân công giao' }).click();
      await expect(dispatcher.page.getByText('Đã phân công tài xế giao hàng.')).toBeVisible();
      await expect
        .poll(() => deliverySocketFrames.some((frame) => frame.includes('assignment.created')), {
          timeout: 15_000,
          intervals: [250, 500],
        })
        .toBe(true);

      await waitForShipmentStatus(customer.page, shipment.id, 'Đã phân công giao hàng');
      await expect(
        customer.page.getByRole('heading', { name: 'Tài xế đang giao hàng' }),
      ).toHaveCount(0);
      await api.expectCustomerLocationStatus(fixture.actors.customer, shipment.id, 404);

      await deliveryDriver.page.getByRole('link', { name: 'Giao hàng', exact: true }).click();
      const deliveryRow = deliveryDriver.page.locator('tr', { hasText: shipment.trackingCode });
      await expect(deliveryRow).toBeVisible();
      await deliveryRow.getByRole('link', { name: 'Mở chi tiết' }).click();
      await expect(
        deliveryDriver.page.getByRole('heading', { name: 'Bản đồ đến kho đích' }),
      ).toBeVisible();
      await expect(
        deliveryDriver.page.getByRole('heading', { name: 'Bản đồ đến người nhận' }),
      ).toHaveCount(0);
      const destinationMap = deliveryDriver.page.getByRole('region', {
        name: 'Bản đồ đến kho đích: vị trí tài xế và điểm đến được phép',
      });
      await expect(destinationMap.locator('path.leaflet-interactive')).toHaveCount(2);
      await expect(
        deliveryDriver.page
          .getByRole('list', { name: 'Chú thích bản đồ' })
          .getByText(fixture.warehouseNames.destination),
      ).toBeVisible();
      await expectMinimumControlHeight(deliveryDriver.page, 'Bắt đầu giao hàng');

      const customerSocketFrames: string[] = [];
      observeSocketFrames(customer.page, customerSocketFrames);
      await deliveryDriver.page.getByRole('button', { name: 'Bắt đầu giao hàng' }).click();
      await expect(deliveryDriver.page.getByText('Đang giao hàng', { exact: true })).toBeVisible();
      await expect(
        deliveryDriver.page.getByRole('heading', { name: 'Bản đồ đến người nhận' }),
      ).toBeVisible();
      const receiverMap = deliveryDriver.page.getByRole('region', {
        name: 'Bản đồ đến người nhận: vị trí tài xế và điểm đến được phép',
      });
      await expect(receiverMap.locator('path.leaflet-interactive')).toHaveCount(2);
      await expect(
        deliveryDriver.page
          .getByRole('list', { name: 'Chú thích bản đồ' })
          .getByText('Người nhận Phase F'),
      ).toBeVisible();

      await api.expectCustomerLocationStatus(fixture.actors.customer, shipment.id, 200);
      await customer.page.reload();
      await expect(
        customer.page.getByRole('heading', { name: 'Đang giao hàng', exact: true }),
      ).toBeVisible();
      await expect(
        customer.page.getByRole('heading', { name: 'Tài xế đang giao hàng' }),
      ).toBeVisible();
      const customerMap = customer.page.getByRole('region', { name: 'Bản đồ vị trí tài xế' });
      await expect(customerMap).toBeVisible();
      await expect(customerMap.locator('.leaflet-interactive')).toBeVisible();
      await expect
        .poll(
          () => customerSocketFrames.some((frame) => frame.includes('driver.location.updated')),
          { timeout: 15_000, intervals: [500] },
        )
        .toBe(true);

      await deliveryDriver.page.getByRole('link', { name: 'Ghi nhận POD' }).click();
      const completeButton = deliveryDriver.page.getByRole('button', { name: 'Xác nhận đã giao' });
      await expect(completeButton).toBeDisabled();
      await deliveryDriver.page.getByLabel(/Tên người nhận/).fill('Người nhận Phase F');
      await deliveryDriver.page.getByLabel('Ghi chú (tùy chọn)').fill('POD ký nhận tại cửa');
      await deliveryDriver.page
        .getByLabel('Số tiền phí vận chuyển đã thu (VND)')
        .fill(String(shipment.totalFee));
      await expect(completeButton).toBeEnabled();
      await completeButton.click();
      await expect(
        deliveryDriver.page.getByText(
          'Đã hoàn tất giao hàng, thu phí vận chuyển và ghi nhận Proof of Delivery.',
        ),
      ).toBeVisible();
      await expect(
        deliveryDriver.page.getByRole('heading', { name: 'Proof of Delivery' }),
      ).toBeVisible();

      await expect(
        customer.page.getByRole('heading', { name: 'Tài xế đang giao hàng' }),
      ).toHaveCount(0);
      await expect(customer.page.getByRole('heading', { name: 'Đã giao hàng' })).toBeVisible();
      const locationFrameCount = customerSocketFrames.filter((frame) =>
        frame.includes('driver.location.updated'),
      ).length;
      await deliveryDriver.page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/driver/location') && response.status() === 200,
        { timeout: 10_000 },
      );
      await expect
        .poll(
          () =>
            customerSocketFrames.filter((frame) => frame.includes('driver.location.updated'))
              .length,
          { timeout: 1_500, intervals: [250] },
        )
        .toBe(locationFrameCount);
      await api.expectCustomerLocationStatus(fixture.actors.customer, shipment.id, 404);
      await expectNoHorizontalOverflow(deliveryDriver.page);
      await expectNoHorizontalOverflow(customer.page);

      const admin = register(
        await openRoleBrowser({
          browser,
          actor: fixture.actors.admin,
          expectedPath: '/admin/dashboard',
          homeHeading: 'Dashboard quản trị',
          viewport: { width: 1440, height: 900 },
        }),
      );
      await expectSessionAfterReload(admin.page, '/admin/dashboard', 'Dashboard quản trị');
      await admin.page.getByRole('link', { name: 'Vận đơn', exact: true }).click();
      await expect(admin.page.getByRole('heading', { name: 'Tất cả vận đơn' })).toBeVisible();
      await expect(admin.page.getByText(shipment.trackingCode, { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(admin.page);

      // A rotated session followed by a legitimate business conflict must not sign out the user.
      const rotated = await customer.context.request.post(
        'http://localhost:3000/api/v1/auth/refresh',
      );
      expect(rotated.status()).toBe(200);
      const conflict = await customer.page.evaluate(async (shipmentId) => {
        const source = '/src/services/api.ts';
        const loaded: unknown = await import(source);
        const { api } = loaded as {
          api: { post: (path: string, body: unknown) => Promise<unknown> };
        };
        try {
          await api.post(`/shipments/${shipmentId}/cancel`, {
            reason: 'Cannot cancel a delivered shipment',
          });
          return 200;
        } catch (error: unknown) {
          const sessionSource = '/src/services/auth-session.ts';
          const sessionModule: unknown = await import(sessionSource);
          const { getAuthSession } = sessionModule as { getAuthSession: () => unknown };
          return {
            status: (error as { response?: { status: number } }).response?.status,
            authenticated: Boolean(getAuthSession()),
          };
        }
      }, shipment.id);
      expect(conflict).toEqual({ status: 409, authenticated: true });
      await customer.page.reload();
      await expect(customer.page).toHaveURL(new RegExp(`/shipments/${shipment.id}$`));
      await expect(customer.page.getByRole('heading', { name: 'Đã giao hàng' })).toBeVisible();

      expect(await fixture.outcome(shipment.id)).toEqual({
        status: 'DELIVERED',
        shippingFeePayer: 'RECEIVER',
        proofCount: 2,
        attemptCount: 1,
        transferCount: 1,
        deliveredTrackingCount: 1,
        cod: {
          expectedAmount: 450_000,
          collectedAmount: 450_000,
          status: 'COLLECTED',
        },
      });
    } finally {
      await Promise.allSettled(heartbeatStops.map((stop) => stop()));
      await api.dispose();
      await closeContexts(sessions.map(({ context }) => context));
    }
  });
});

async function startLocationSimulation(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'GPS simulator development' })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/v1/driver/location') && response.status() === 200,
      { timeout: 10_000 },
    ),
    page.getByRole('button', { name: 'Start' }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
}

async function expectCandidateEligibility(
  select: Locator,
  expected: { included: string[]; excluded: string[] },
): Promise<void> {
  await expect
    .poll(() => select.locator('option').allTextContents())
    .toEqual(
      expect.arrayContaining(expected.included.map((name) => expect.stringContaining(name))),
    );
  const text = (await select.locator('option').allTextContents()).join('\n');
  for (const excluded of expected.excluded) expect(text).not.toContain(excluded);
  for (const included of expected.included) {
    const option = (await select.locator('option').allTextContents()).find((value) =>
      value.includes(included),
    );
    expect(option).toContain('đường bộ');
    expect(option).toContain('phút');
  }
}

async function expectCandidateRanking(
  select: Locator,
  nearName: string,
  farName: string,
): Promise<void> {
  const options = await select.locator('option').allTextContents();
  const nearIndex = options.findIndex((option) => option.includes(nearName));
  const farIndex = options.findIndex((option) => option.includes(farName));
  expect(nearIndex).toBeGreaterThan(0);
  expect(farIndex).toBeGreaterThan(0);
  expect(nearIndex).toBeLessThan(farIndex);
}

function observeSocketFrames(page: Page, frames: string[]): void {
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') frames.push(payload);
    });
  });
}

async function closeContexts(contexts: BrowserContext[]): Promise<void> {
  await Promise.allSettled(contexts.map((context) => context.close()));
}
