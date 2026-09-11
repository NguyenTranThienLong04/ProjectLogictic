import { expect, test, type BrowserContext } from './support/test.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  openRoleBrowser,
} from './support/browser-session.js';
import { createPhaseH1Fixture, type PhaseH1FixtureValue } from './support/phase-h1-fixture.js';

test.describe.serial('Phase H1 shipping fee browser flow', () => {
  let fixture: PhaseH1FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseH1Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('collects sender/receiver fees at their owned lifecycle points and keeps COD separate', async ({
    browser,
  }) => {
    const pickup = await openRoleBrowser({
      browser,
      actor: fixture.actors.pickupDriver,
      expectedPath: '/driver/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 375, height: 812 },
    });
    contexts.push(pickup.context);
    await pickup.page.goto(`/driver/pickups/${fixture.pickupAssignmentId}`);
    await expect(pickup.page.getByRole('heading', { name: 'Phí vận chuyển' })).toBeVisible();
    await expect(pickup.page.getByText('Người gửi trả phí', { exact: true })).toBeVisible();
    await expect(pickup.page.getByText('35.000 ₫', { exact: true }).first()).toBeVisible();
    await expect(
      pickup.page.getByRole('button', { name: 'Thu phí và xác nhận đã lấy hàng' }),
    ).toBeDisabled();
    const pickupAmount = pickup.page.getByLabel('Số tiền phí vận chuyển đã thu (VND)');
    await pickupAmount.fill(String(fixture.senderFee - 1));
    await pickupAmount.blur();
    await expect(pickup.page.getByText('Số tiền phải đúng 35.000 ₫.')).toBeVisible();
    await pickupAmount.fill(String(fixture.senderFee));
    await expectMinimumControlHeight(pickup.page, 'Thu phí và xác nhận đã lấy hàng', 48);
    await Promise.all([
      pickup.page.waitForResponse(
        (response) =>
          response.url().includes(`/driver/assignments/${fixture.pickupAssignmentId}/pickup`) &&
          response.status() === 200,
      ),
      pickup.page.getByRole('button', { name: 'Thu phí và xác nhận đã lấy hàng' }).click(),
    ]);
    await expect(pickup.page.getByText('Đã thu phí vận chuyển', { exact: true })).toBeVisible();
    await expect(pickup.page.getByText(/Đã xác nhận lấy hàng, thu phí vận chuyển/)).toBeVisible();
    await expectNoHorizontalOverflow(pickup.page);

    const delivery = await openRoleBrowser({
      browser,
      actor: fixture.actors.deliveryDriver,
      expectedPath: '/driver/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 390, height: 844 },
    });
    contexts.push(delivery.context);
    await delivery.page.goto(`/driver/deliveries/${fixture.deliveryAssignmentId}`);
    await expect(delivery.page.getByRole('heading', { name: 'Phí vận chuyển' })).toBeVisible();
    await expect(delivery.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expect(delivery.page.getByText('42.000 ₫', { exact: true }).first()).toBeVisible();
    await expect(delivery.page.getByText('500.000 ₫', { exact: true })).toBeVisible();
    await expect(
      delivery.page.getByRole('link', { name: 'Ghi nhận POD và thu phí' }),
    ).toBeVisible();
    await delivery.page.getByRole('link', { name: 'Ghi nhận POD và thu phí' }).click();
    const deliveryAmount = delivery.page.getByLabel('Số tiền phí vận chuyển đã thu (VND)');
    await deliveryAmount.fill(String(fixture.receiverFee + 1));
    await deliveryAmount.blur();
    await expect(delivery.page.getByText('Số tiền phải đúng 42.000 ₫.')).toBeVisible();
    await delivery.page.getByLabel('Tên người nhận').fill('Người nhận Browser H1');
    await deliveryAmount.fill(String(fixture.receiverFee));
    await expectMinimumControlHeight(delivery.page, 'Thu phí và xác nhận đã giao', 48);
    await Promise.all([
      delivery.page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/driver/delivery-assignments/${fixture.deliveryAssignmentId}/complete`) &&
          response.status() === 200,
      ),
      delivery.page.getByRole('button', { name: 'Thu phí và xác nhận đã giao' }).click(),
    ]);
    await expect(
      delivery.page.getByText(/Đã hoàn tất giao hàng, thu phí vận chuyển/),
    ).toBeVisible();
    await expect(delivery.page.getByText('Đã thu phí vận chuyển', { exact: true })).toBeVisible();
    await expect(delivery.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expect(delivery.page.getByText('500.000 ₫', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(delivery.page);

    const customer = await openRoleBrowser({
      browser,
      actor: fixture.actors.customer,
      expectedPath: '/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 1024, height: 768 },
    });
    contexts.push(customer.context);
    await customer.page.goto(`/shipments/${fixture.receiverShipmentId}`);
    await expect(customer.page.getByRole('heading', { name: 'Phí vận chuyển' })).toBeVisible();
    await expect(customer.page.getByText('Người nhận trả phí', { exact: true })).toBeVisible();
    await expect(customer.page.getByText('Đã thu phí vận chuyển', { exact: true })).toBeVisible();
    await expect(customer.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expectNoHorizontalOverflow(customer.page);

    const admin = await openRoleBrowser({
      browser,
      actor: fixture.actors.admin,
      expectedPath: '/admin/dashboard',
      homeHeading: 'Dashboard quản trị',
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(admin.context);
    await admin.page.goto(`/admin/shipments/${fixture.receiverShipmentId}`);
    await expect(admin.page.getByRole('heading', { name: 'Phí vận chuyển' })).toBeVisible();
    await expect(admin.page.getByText('Đã thu phí vận chuyển', { exact: true })).toBeVisible();
    await expect(admin.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expectNoHorizontalOverflow(admin.page);
  });
});
