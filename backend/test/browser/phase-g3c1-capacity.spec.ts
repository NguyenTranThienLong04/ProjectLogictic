import { expect, request, test, type BrowserContext, type Page } from './support/test.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  openRoleBrowser,
} from './support/browser-session.js';
import {
  createPhaseG3C1Fixture,
  type PhaseG3C1FixtureValue,
} from './support/phase-g3c1-fixture.js';

test.describe.serial('Phase G3C1 line-haul capacity browser flow', () => {
  let fixture: PhaseG3C1FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseG3C1Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('shows authoritative utilization, blocks overload and locks an exactly-full manifest', async ({
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
    await page.goto(`/dispatcher/line-haul/${fixture.tripId}`);
    await expect(page.getByRole('heading', { name: fixture.tripCode })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sức tải manifest' })).toBeVisible();
    await expect(page.getByText('0 kg / 1.000 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('0% tải · Còn 1.000 kg', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await assignTransfer(page, fixture.tripId, fixture.transfers.fourHundred.id);
    await expect(page.getByText('400 kg / 1.000 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('40% tải · Còn 600 kg', { exact: true })).toBeVisible();

    await assignTransfer(page, fixture.tripId, fixture.transfers.fiveHundred.id);
    await expect(page.getByText('900 kg / 1.000 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('90% tải · Còn 100 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('Gần đầy', { exact: true })).toBeVisible();

    const overloadOption = page.locator(
      `select#eligible-transfer option[value="${fixture.transfers.overload.id}"]`,
    );
    await expect(overloadOption).toHaveCount(1);
    await expect(overloadOption).toBeDisabled();
    await expect(overloadOption).toContainText('150 kg');
    await expect(overloadOption).toContainText('Vượt sức tải');

    const fiveHundredRow = page
      .getByRole('row')
      .filter({ hasText: fixture.transfers.fiveHundred.code });
    await fiveHundredRow.getByRole('button', { name: 'Gỡ khỏi chuyến' }).click();
    const removeDialog = page.getByRole('dialog', { name: 'Xác nhận gỡ WarehouseTransfer' });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/v1/line-haul/trips/${fixture.tripId}/transfers/${fixture.transfers.fiveHundred.id}/remove`,
            ) && response.status() === 200,
      ),
      removeDialog.getByRole('button', { name: 'Gỡ khỏi chuyến' }).click(),
    ]);
    await expect(page.getByText('400 kg / 1.000 kg', { exact: true })).toBeVisible();
    await assignTransfer(page, fixture.tripId, fixture.transfers.fiveHundred.id);
    await expect(page.getByText('900 kg / 1.000 kg', { exact: true })).toBeVisible();

    await page.locator('#eligible-transfer').selectOption(fixture.transfers.exactRemainder.id);
    await expect(
      page.getByRole('status').filter({ hasText: 'Sau khi gán: 1.000 kg' }),
    ).toBeVisible();

    const api = await request.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const login = await api.post('/api/v1/auth/login', {
      data: {
        email: fixture.actors.dispatcher.email,
        password: fixture.actors.dispatcher.password,
      },
    });
    expect(login.ok()).toBe(true);
    const loginBody = (await login.json()) as { data: { accessToken: string } };
    const authorization = { Authorization: `Bearer ${loginBody.data.accessToken}` };
    const concurrentAdd = await api.post(`/api/v1/line-haul/trips/${fixture.tripId}/transfers`, {
      headers: authorization,
      data: { transferId: fixture.transfers.raceFifty.id },
    });
    expect(concurrentAdd.ok()).toBe(true);

    await page.getByRole('button', { name: 'Gán vào chuyến' }).click();
    const staleDialog = page.getByRole('dialog', { name: 'Xác nhận gán WarehouseTransfer' });
    const rejectedResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/line-haul/trips/${fixture.tripId}/transfers`) &&
        response.status() === 409,
    );
    await staleDialog.getByRole('button', { name: 'Gán transfer' }).click();
    await rejectedResponse;
    await expect(
      page.getByText(/Manifest exceeds vehicle capacity; remove cargo or choose a larger vehicle/i),
    ).toBeVisible();
    await staleDialog.getByRole('button', { name: 'Quay lại' }).click();

    const concurrentRemove = await api.post(
      `/api/v1/line-haul/trips/${fixture.tripId}/transfers/${fixture.transfers.raceFifty.id}/remove`,
      { headers: authorization },
    );
    expect(concurrentRemove.ok()).toBe(true);
    await api.dispose();

    await page.getByRole('button', { name: 'Gán vào chuyến' }).click();
    const exactDialog = page.getByRole('dialog', { name: 'Xác nhận gán WarehouseTransfer' });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.tripId}/transfers`) &&
          response.status() === 200,
      ),
      exactDialog.getByRole('button', { name: 'Gán transfer' }).click(),
    ]);
    await expect(page.getByText('1.000 kg / 1.000 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('100% tải · Còn 0 kg', { exact: true })).toBeVisible();
    await expect(page.getByText('Đầy tải', { exact: true })).toBeVisible();

    await expectMinimumControlHeight(page, 'Mark Ready');
    await page.getByRole('button', { name: 'Mark Ready' }).click();
    const readyDialog = page.getByRole('dialog', { name: 'Mark Ready chuyến liên kho' });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/line-haul/trips/${fixture.tripId}/prepare`) &&
          response.status() === 200,
      ),
      readyDialog.getByRole('button', { name: 'Khóa manifest' }).click(),
    ]);
    await expect(page.getByText(/Snapshot READY:/)).toBeVisible();
    await expect(page.getByText('Sẵn sàng xuất phát', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gán vào chuyến' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Gỡ khỏi chuyến' })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('heading', { name: 'Sức tải manifest' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const warehouse = await openRoleBrowser({
      browser,
      actor: fixture.actors.originStaff,
      expectedPath: '/warehouse/workspace',
      homeHeading: fixture.originWarehouseName,
      viewport: { width: 390, height: 844 },
    });
    contexts.push(warehouse.context);
    await warehouse.page.goto('/warehouse/line-haul');
    await expect(warehouse.page.getByRole('heading', { name: 'Chuyến liên kho' })).toBeVisible();
    await expect(warehouse.page.getByText(fixture.tripCode)).toBeVisible();
    await expect(
      warehouse.page.getByText('1.000 kg / 1.000 kg', { exact: true }).first(),
    ).toBeVisible();
    await expect(warehouse.page.getByText('Đầy tải', { exact: true })).toBeVisible();
    await expect(warehouse.page.getByText('3 kiện · đã nhận 0', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(warehouse.page);

    await warehouse.page.getByRole('link', { name: fixture.tripCode }).click();
    await expect(warehouse.page.getByRole('heading', { name: 'Sức tải manifest' })).toBeVisible();
    await expect(
      warehouse.page.getByText('1.000 kg / 1.000 kg', { exact: true }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(warehouse.page);
  });
});

async function assignTransfer(page: Page, tripId: string, transferId: string): Promise<void> {
  const option = page.locator(`select#eligible-transfer option[value="${transferId}"]`);
  await expect(option).toHaveCount(1);
  await expect(option).toBeEnabled();
  await page.locator('#eligible-transfer').selectOption(transferId);
  await page.getByRole('button', { name: 'Gán vào chuyến' }).click();
  const dialog = page.getByRole('dialog', { name: 'Xác nhận gán WarehouseTransfer' });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/line-haul/trips/${tripId}/transfers`) &&
        response.status() === 200,
    ),
    dialog.getByRole('button', { name: 'Gán transfer' }).click(),
  ]);
}
