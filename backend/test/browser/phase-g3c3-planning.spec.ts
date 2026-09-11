import { expect, test, type BrowserContext } from './support/test.js';
import { expectNoHorizontalOverflow, openRoleBrowser } from './support/browser-session.js';
import {
  createPhaseG3C3Fixture,
  type PhaseG3C3FixtureValue,
} from './support/phase-g3c3-fixture.js';

test.describe.serial('Phase G3C3 suggested planning browser flow', () => {
  let fixture: PhaseG3C3FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseG3C3Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('reviews a recommendation, prefills Create Trip and submits through backend validation', async ({
    browser,
  }) => {
    const dispatcher = await openRoleBrowser({
      browser,
      actor: fixture.actors.dispatcher,
      expectedPath: '/dispatcher/dashboard',
      homeHeading: 'Dashboard điều phối',
      viewport: { width: 1440, height: 1100 },
    });
    contexts.push(dispatcher.context);
    const page = dispatcher.page;
    await page.goto('/dispatcher/line-haul');
    await expect(page.getByRole('heading', { name: 'Đề xuất kế hoạch' })).toBeVisible();
    await page.locator('#planning-origin').selectOption(fixture.originWarehouseId);
    await page.locator('#planning-destination').selectOption(fixture.destinationWarehouseId);
    await page.locator('#planning-earliest-start').fill('2037-04-20T08:00');
    await page.locator('#planning-latest-end').fill('2037-04-20T20:00');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/line-haul/planning/recommendations') &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: 'Xem đề xuất' }).click(),
    ]);

    const firstRecommendation = page.getByRole('article', { name: 'Đề xuất hạng 1' });
    await expect(firstRecommendation).toContainText(fixture.driverCode);
    await expect(firstRecommendation).toContainText(fixture.vehicleCode);
    await expect(firstRecommendation).toContainText('90%');
    for (const transferCode of fixture.transferCodes) {
      await expect(firstRecommendation).toContainText(transferCode);
    }
    await firstRecommendation.getByRole('button', { name: 'Dùng đề xuất này' }).click();
    await expect(page.getByText(/Đang dùng đề xuất hạng 1/)).toBeVisible();
    await expect(page.locator('#line-haul-origin')).toHaveValue(fixture.originWarehouseId);
    await expect(page.locator('#line-haul-destination')).toHaveValue(
      fixture.destinationWarehouseId,
    );
    await expect(page.locator('#line-haul-driver')).toHaveValue(fixture.driverId);
    await expect(page.locator('#line-haul-vehicle')).toHaveValue(fixture.vehicleId);

    await page.getByRole('button', { name: 'Review và lập chuyến đề xuất' }).click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận lập chuyến liên kho' });
    await expect(dialog).toContainText('Không có dispatch tự động');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/line-haul/trips') && response.status() === 201,
      ),
      dialog.getByRole('button', { name: 'Lập chuyến' }).click(),
    ]);

    await expect(page.getByRole('heading', { level: 1, name: /^LHT-/ })).toBeVisible();
    await expect(page.getByText('2 kiện', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#line-haul-scheduled-start')).toHaveValue('2037-04-20T08:00');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });
});
