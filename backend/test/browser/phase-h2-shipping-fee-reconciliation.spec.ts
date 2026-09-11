import { expect, test, type BrowserContext } from './support/test.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  openRoleBrowser,
} from './support/browser-session.js';
import { createPhaseH2Fixture, type PhaseH2FixtureValue } from './support/phase-h2-fixture.js';

test.describe.serial('Phase H2 shipping fee reconciliation browser flow', () => {
  let fixture: PhaseH2FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseH2Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('Driver remits, Admin disputes/resolves/settles, and Customer sees only public fee state', async ({
    browser,
  }) => {
    const driver = await openRoleBrowser({
      browser,
      actor: fixture.actors.driver,
      expectedPath: '/driver/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 375, height: 812 },
    });
    contexts.push(driver.context);
    await driver.page.goto('/driver/shipping-fees');
    await expect(driver.page.getByRole('heading', { name: 'Bàn giao phí đã thu' })).toBeVisible();
    await expect(driver.page.getByText(fixture.trackingCode, { exact: true })).toBeVisible();
    await expect(
      driver.page.getByText('Đã thu phí vận chuyển', { exact: true }).last(),
    ).toBeVisible();
    await expectMinimumControlHeight(driver.page, 'Bàn giao phí', 48);
    await driver.page.getByRole('button', { name: 'Bàn giao phí' }).click();
    const remittanceDialog = driver.page.getByRole('dialog', { name: 'Bàn giao phí vận chuyển' });
    const amount = remittanceDialog.getByLabel('Số tiền bàn giao (VND)');
    const confirmRemittance = remittanceDialog.getByRole('button', { name: 'Xác nhận bàn giao' });
    await expect(confirmRemittance).toBeDisabled();
    await amount.fill(String(fixture.feeAmount - 1));
    await amount.blur();
    await expect(remittanceDialog.getByText('Số tiền phải đúng 35.000 ₫.')).toBeVisible();
    await amount.fill(String(fixture.feeAmount));
    await Promise.all([
      driver.page.waitForResponse(
        (response) =>
          response.url().includes(`/shipping-fees/${fixture.shippingFeeId}/remit`) &&
          response.status() === 200,
      ),
      confirmRemittance.click(),
    ]);
    await expect(
      driver.page.getByText('Tài xế đã bàn giao phí', { exact: true }).last(),
    ).toBeVisible();
    await expect(driver.page.getByText(/Đã ghi nhận bàn giao phí/)).toBeVisible();
    await expectNoHorizontalOverflow(driver.page);

    const admin = await openRoleBrowser({
      browser,
      actor: fixture.actors.admin,
      expectedPath: '/admin/dashboard',
      homeHeading: 'Dashboard quản trị',
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(admin.context);
    await admin.page.goto('/admin/shipping-fees');
    await expect(
      admin.page.getByRole('heading', { name: 'Đối soát phí vận chuyển' }),
    ).toBeVisible();
    await expect(admin.page.getByText(/Đối chiếu phí vận chuyển độc lập với COD/)).toBeVisible();
    const search = admin.page.getByLabel('Tìm vận đơn hoặc tài xế');
    await search.fill(fixture.trackingCode);
    await search.press('Enter');
    const row = admin.page.locator('tr', { hasText: fixture.trackingCode });
    await expect(row).toBeVisible();
    await expect(row.getByText(fixture.driverName, { exact: false }).first()).toBeVisible();
    await expect(row.getByText(fixture.driverEmployeeCode, { exact: false }).first()).toBeVisible();
    await expect(row.getByText('Tài xế đã bàn giao phí', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Tranh chấp' }).click();
    const disputeDialog = admin.page.getByRole('dialog', { name: 'Tranh chấp phí vận chuyển' });
    const openDispute = disputeDialog.getByRole('button', { name: 'Mở tranh chấp' });
    await expect(openDispute).toBeDisabled();
    await disputeDialog.getByLabel('Lý do tranh chấp').fill('Biên nhận bàn giao cần đối chiếu');
    await Promise.all([
      admin.page.waitForResponse(
        (response) =>
          response.url().includes(`/shipping-fees/${fixture.shippingFeeId}/dispute`) &&
          response.status() === 200,
      ),
      openDispute.click(),
    ]);
    await expect(row.getByText('Phí vận chuyển đang tranh chấp', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Đối soát' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Giải quyết' }).click();
    const resolveDialog = admin.page.getByRole('dialog', { name: 'Giải quyết tranh chấp' });
    await resolveDialog.getByLabel('Kết quả xác minh').fill('Đã xác minh đủ tiền và biên nhận');
    await Promise.all([
      admin.page.waitForResponse(
        (response) =>
          response.url().includes(`/shipping-fees/${fixture.shippingFeeId}/resolve`) &&
          response.status() === 200,
      ),
      resolveDialog.getByRole('button', { name: 'Xác nhận giải quyết' }).click(),
    ]);
    await expect(row.getByText('Tài xế đã bàn giao phí', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Đối soát' }).click();
    const settlementDialog = admin.page.getByRole('dialog', {
      name: 'Hoàn tất đối soát phí vận chuyển?',
    });
    await Promise.all([
      admin.page.waitForResponse(
        (response) =>
          response.url().includes(`/shipping-fees/${fixture.shippingFeeId}/settle`) &&
          response.status() === 200,
      ),
      settlementDialog.getByRole('button', { name: 'Xác nhận đối soát' }).click(),
    ]);
    await expect(row.getByText('Đã đối soát phí vận chuyển', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Đối soát' })).toHaveCount(0);
    await expectNoHorizontalOverflow(admin.page);

    const customer = await openRoleBrowser({
      browser,
      actor: fixture.actors.customer,
      expectedPath: '/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 390, height: 844 },
    });
    contexts.push(customer.context);
    await customer.page.goto('/admin/shipping-fees');
    await expect(customer.page).toHaveURL(/\/dashboard$/);
    await customer.page.goto(`/shipments/${fixture.shipmentId}`);
    await expect(customer.page.getByRole('heading', { name: 'Phí vận chuyển' })).toBeVisible();
    await expect(
      customer.page.getByText('Đã đối soát phí vận chuyển', { exact: true }),
    ).toBeVisible();
    await expect(customer.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expect(customer.page.getByText('180.000 ₫', { exact: true }).first()).toBeVisible();
    await expect(customer.page.getByText(fixture.driverName, { exact: false })).toHaveCount(0);
    await expect(customer.page.getByText(fixture.driverEmployeeCode, { exact: false })).toHaveCount(
      0,
    );
    await expectNoHorizontalOverflow(customer.page);
  });
});
