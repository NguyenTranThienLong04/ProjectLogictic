import { expect, test, type BrowserContext } from './support/test.js';
import { expectNoHorizontalOverflow, openRoleBrowser } from './support/browser-session.js';
import {
  createPhaseG3C2Fixture,
  type PhaseG3C2FixtureValue,
} from './support/phase-g3c2-fixture.js';

test.describe.serial('Phase G3C2 line-haul scheduling browser flow', () => {
  let fixture: PhaseG3C2FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseG3C2Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('shows busy resources, allows an adjacent window, reschedules and unschedules', async ({
    browser,
  }) => {
    const dispatcher = await openRoleBrowser({
      browser,
      actor: fixture.actors.dispatcher,
      expectedPath: '/dispatcher/dashboard',
      homeHeading: 'Dashboard điều phối',
      viewport: { width: 1440, height: 960 },
    });
    contexts.push(dispatcher.context);
    const page = dispatcher.page;
    await page.goto(`/dispatcher/line-haul/${fixture.targetTripId}`);
    await expect(page.getByRole('heading', { name: fixture.targetTripCode })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lịch tài xế và xe' })).toBeVisible();

    await page.locator('#line-haul-scheduled-start').fill('2032-06-15T10:30');
    await page.locator('#line-haul-scheduled-end').fill('2032-06-15T11:30');
    const assignedDriver = page.locator('li').filter({ hasText: fixture.assignedDriverCode });
    const assignedVehicle = page.locator('li').filter({ hasText: fixture.assignedVehicleCode });
    await expect(assignedDriver).toContainText(fixture.blockingTripCode);
    await expect(assignedVehicle).toContainText(fixture.blockingTripCode);
    await expect(assignedDriver.getByText('Bận', { exact: true })).toBeVisible();
    await expect(assignedVehicle.getByText('Bận', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lên lịch' })).toBeDisabled();

    await page.locator('#line-haul-scheduled-start').fill('2032-06-15T12:00');
    await page.locator('#line-haul-scheduled-end').fill('2032-06-15T14:00');
    await expect(assignedDriver).toContainText('Đã gán');
    await expect(assignedVehicle).toContainText('Đã gán');
    await expect(assignedDriver.getByText('Rảnh', { exact: true })).toBeVisible();
    await expect(assignedVehicle.getByText('Rảnh', { exact: true })).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.targetTripId}/schedule`) &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: 'Lên lịch' }).click(),
    ]);
    await expect(page.getByText(`Đã lên lịch chuyến ${fixture.targetTripCode}.`)).toBeVisible();

    await page.goto('/dispatcher/line-haul');
    await page.locator('#line-haul-schedule-date').fill('2032-06-15');
    const targetRow = page
      .getByRole('region', { name: 'Bảng lịch chuyến' })
      .getByRole('row')
      .filter({ hasText: fixture.targetTripCode });
    await expect(targetRow).toContainText(fixture.assignedDriverCode);
    await expect(targetRow).toContainText(fixture.assignedVehicleCode);
    await expect(targetRow).toContainText('12:00');
    await expect(targetRow).toContainText('14:00');
    await expectNoHorizontalOverflow(page);

    await targetRow.getByRole('link', { name: fixture.targetTripCode }).click();
    await page.locator('#line-haul-scheduled-start').fill('2032-06-15T14:00');
    await page.locator('#line-haul-scheduled-end').fill('2032-06-15T16:00');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.targetTripId}/reschedule`) &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: 'Đổi lịch' }).click(),
    ]);
    await expect(page.getByText(`Đã đổi lịch chuyến ${fixture.targetTripCode}.`)).toBeVisible();

    await page.getByRole('button', { name: 'Gỡ lịch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận gỡ lịch chuyến' });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.targetTripId}/unschedule`) &&
          response.status() === 200,
      ),
      dialog.getByRole('button', { name: 'Gỡ lịch' }).click(),
    ]);
    await expect(page.getByText(new RegExp(`Đã gỡ lịch ${fixture.targetTripCode}`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lên lịch' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });
});
