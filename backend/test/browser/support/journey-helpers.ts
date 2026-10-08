import { expect, type Page } from '@playwright/test';
import type { PhaseFFixture } from './phase-f-fixture.js';

interface CreatedShipment {
  id: string;
  trackingCode: string;
  totalFee: number;
}

interface ShipmentEnvelope {
  data: CreatedShipment;
}

export async function createShipmentThroughBrowser(
  page: Page,
  fixture: PhaseFFixture,
): Promise<CreatedShipment> {
  let delayed = false;
  await page.route('**/api/v1/addresses', async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await page.getByRole('link', { name: 'Tạo vận đơn' }).click();
  await expect(page.getByText('Đang chuẩn bị biểu mẫu vận đơn')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Gửi một kiện hàng mới' }),
  ).toBeVisible();
  await page.unroute('**/api/v1/addresses');

  const createButton = page.getByRole('button', { name: 'Tạo vận đơn' });
  await expect(createButton).toBeDisabled();
  await page.getByRole('button', { name: 'Tính lại phí' }).click();
  await expect(page.locator('#shipment-pickup-address-error')).toHaveText('Chọn địa chỉ lấy hàng');

  const pickupAddressSelect = page.getByLabel('Địa chỉ đã lưu');
  const pickupAddressValue = await pickupAddressSelect
    .locator('option')
    .filter({ hasText: fixture.pickupAddressLabel })
    .getAttribute('value');
  expect(pickupAddressValue).toBeTruthy();
  await pickupAddressSelect.selectOption(pickupAddressValue ?? '');
  await page.getByLabel('Tên người nhận').fill('Người nhận Phase F');
  await page.getByLabel('Số điện thoại').fill('0987654321');
  await page.getByLabel('Số nhà, tên đường').fill('50 Tôn Đức Thắng');
  await page.getByRole('combobox', { name: 'Tỉnh / thành phố', exact: true }).fill('Hồ Chí Minh');
  await page.getByRole('option', { name: 'Hồ Chí Minh', exact: true }).click();
  await page.getByRole('combobox', { name: 'Phường / xã', exact: true }).fill('Bến Thành');
  await page.getByRole('option', { name: 'Bến Thành', exact: true }).click();
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 10.7865, longitude: 106.7045 });
  await page.getByRole('button', { name: 'Dùng vị trí hiện tại', exact: true }).click();
  const confirmLocation = page.getByRole('button', { name: 'Xác nhận vị trí', exact: true });
  await expect(confirmLocation).toBeEnabled();
  await confirmLocation.click();
  await page.getByLabel('Mô tả hàng hóa').fill('Kiện hàng Phase F browser');
  await page.getByLabel('Loại kiện').selectOption('PARCEL');
  await page.getByLabel('Khối lượng (gram)').fill('2100');
  await page.getByLabel('Dài (cm)').fill('32');
  await page.getByLabel('Rộng (cm)').fill('24');
  await page.getByLabel('Cao (cm)').fill('18');
  await page.getByLabel('Tiền thu hộ COD (VND)').fill('450000');
  await page.getByRole('radio', { name: /Người nhận trả phí/ }).check();

  const [quoteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/pricing/quote' &&
        response.request().method() === 'POST',
      { timeout: 20_000 },
    ),
    page.getByRole('button', { name: 'Tính lại phí' }).click(),
  ]);
  expect(quoteResponse.status()).toBe(200);
  await expect(createButton).toBeEnabled();
  await expect(page.getByText('Xác nhận thanh toán')).toBeVisible();
  await expect(page.getByText('Người nhận trả phí', { exact: true }).last()).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/v1/shipments' &&
        candidate.request().method() === 'POST',
      { timeout: 20_000 },
    ),
    createButton.click(),
  ]);
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ShipmentEnvelope;
  await expect(page).toHaveURL(new RegExp(`/shipments/${body.data.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: body.data.trackingCode })).toBeVisible();
  await expect(page.getByText('Chờ xác nhận', { exact: true })).toBeVisible();
  await expect(page.getByText('Người nhận trả phí', { exact: true })).toBeVisible();
  return body.data;
}

export async function waitForShipmentStatus(
  page: Page,
  shipmentId: string,
  statusLabel: string,
): Promise<void> {
  await expect(async () => {
    await page.goto(`/shipments/${shipmentId}`);
    await expect(page.getByText(statusLabel, { exact: true })).toBeVisible();
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

export async function runOriginWarehouseFlow(
  page: Page,
  trackingCode: string,
  destinationWarehouseName: string,
): Promise<void> {
  await page.getByLabel('Mã vận đơn hoặc mã vạch').fill(trackingCode);
  await page.getByRole('button', { name: 'Tra cứu kiện' }).click();
  const checkInDialog = page.getByRole('dialog', {
    name: new RegExp(`Kiểm hàng & nhập kho.*${trackingCode}`),
  });
  await expect(checkInDialog).toBeVisible();
  const checkInButton = checkInDialog.getByRole('button', { name: 'Xác nhận nhập kho' });
  await expect(checkInButton).toBeDisabled();
  await checkInDialog.getByRole('checkbox', { name: /Đã đối chiếu kiện thực tế/ }).check();
  await expect(checkInButton).toBeEnabled();
  await checkInDialog.getByLabel('Ghi chú ngoại quan kiện hàng').fill('Kiện nguyên vẹn');
  await checkInButton.click();
  await expect(page.getByText(new RegExp(`Đã nhập kho.*${trackingCode}`))).toBeVisible();

  const inventoryPanel = page.getByRole('tabpanel', { name: /Tồn kho/ });
  const inventoryRow = inventoryPanel.locator('tr', { hasText: trackingCode });
  await expect(inventoryRow).toBeVisible();
  await inventoryRow.getByRole('button', { name: 'Phân loại' }).click();
  const sortingDialog = page.getByRole('dialog', {
    name: new RegExp(`Phân loại.*${trackingCode}`),
  });
  const destinationSelect = sortingDialog.getByLabel('Kho đích');
  const destinationValue = await destinationSelect
    .locator('option')
    .filter({ hasText: destinationWarehouseName })
    .getAttribute('value');
  expect(destinationValue).toBeTruthy();
  await destinationSelect.selectOption(destinationValue ?? '');
  await sortingDialog.getByRole('button', { name: 'Xác nhận phân loại' }).click();
  await expect(page.getByText(new RegExp(`Đã xác nhận kho đích.*${trackingCode}`))).toBeVisible();

  await inventoryPanel
    .locator('tr', { hasText: trackingCode })
    .getByRole('button', { name: 'Tạo transfer' })
    .click();
  const transferDialog = page.getByRole('dialog', {
    name: new RegExp(`Tạo chuyến liên kho.*${trackingCode}`),
  });
  await expect(transferDialog).toBeVisible();
  await transferDialog.getByLabel('Ghi chú vận hành (tùy chọn)').fill('Phase F browser transfer');
  await transferDialog.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
  await expect(transferDialog).not.toBeVisible();

  const outboundPanel = page.getByRole('tabpanel', { name: /Chuyển đi/ });
  const outboundRow = outboundPanel.locator('tr', { hasText: trackingCode });
  await expect(outboundRow.getByText('Chờ xuất kho', { exact: true })).toBeVisible();
  await expect(outboundRow.getByRole('button', { name: 'Dispatch / xuất kho' })).toHaveCount(0);
}

export async function prepareAndDispatchLineHaul(
  page: Page,
  fixture: PhaseFFixture,
  transferId: string,
): Promise<string> {
  await page.goto('/dispatcher/line-haul');
  await page.locator('#line-haul-origin').selectOption(fixture.warehouseIds.origin);
  await page.locator('#line-haul-destination').selectOption(fixture.warehouseIds.destination);
  await page.locator('#line-haul-driver').selectOption(fixture.lineHaulDriverId);
  await page.locator('#line-haul-vehicle').selectOption(fixture.lineHaulVehicleId);
  await page.getByRole('button', { name: 'Kiểm tra và lập chuyến', exact: true }).click();
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/line-haul/trips' &&
        response.request().method() === 'POST',
    ),
    page
      .getByRole('dialog', { name: 'Xác nhận lập chuyến liên kho' })
      .getByRole('button', { name: 'Lập chuyến', exact: true })
      .click(),
  ]);
  expect(created.status()).toBe(201);
  const { data: trip } = (await created.json()) as { data: { id: string; status: string } };
  expect(trip.status).toBe('PLANNED');
  await expect(page).toHaveURL(new RegExp(`/dispatcher/line-haul/${trip.id}$`));
  await page.locator('#eligible-transfer').selectOption(transferId);
  await page.getByRole('button', { name: 'Gán vào chuyến', exact: true }).click();
  const [assigned] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/line-haul/trips/${trip.id}/transfers` &&
        response.request().method() === 'POST',
    ),
    page
      .getByRole('dialog', { name: 'Xác nhận gán WarehouseTransfer' })
      .getByRole('button', { name: 'Gán transfer', exact: true })
      .click(),
  ]);
  expect(assigned.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Mark Ready', exact: true })).toHaveCount(0);
  const start = Date.now() + 24 * 60 * 60 * 1_000;
  await page.locator('#line-haul-scheduled-start').fill(new Date(start).toISOString().slice(0, 16));
  await page
    .locator('#line-haul-scheduled-end')
    .fill(new Date(start + 2 * 60 * 60 * 1_000).toISOString().slice(0, 16));
  const [scheduled] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/line-haul/trips/${trip.id}/schedule` &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Lên lịch', exact: true }).click(),
  ]);
  expect(scheduled.status()).toBe(200);
  expect(await scheduled.json()).toMatchObject({
    data: { status: 'PLANNED', availableActions: { markReady: true } },
  });
  for (const step of [
    {
      button: 'Mark Ready',
      dialog: 'Mark Ready chuyến liên kho',
      confirm: 'Khóa manifest',
      command: 'prepare',
      status: 'READY',
    },
    {
      button: 'Dispatch chuyến',
      dialog: 'Xác nhận xe rời kho',
      confirm: 'Dispatch chuyến',
      command: 'dispatch',
      status: 'IN_TRANSIT',
    },
  ]) {
    await page.getByRole('button', { name: step.button, exact: true }).click();
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname ===
            `/api/v1/line-haul/trips/${trip.id}/${step.command}` &&
          candidate.request().method() === 'POST',
      ),
      page
        .getByRole('dialog', { name: step.dialog })
        .getByRole('button', { name: step.confirm, exact: true })
        .click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: step.status } });
  }
  await expect(page.getByText('Đang chạy tuyến', { exact: true })).toBeVisible();
  return trip.id;
}

export async function arriveLineHaulThroughBrowser(page: Page, tripId: string): Promise<void> {
  await page.goto(`/warehouse/line-haul/${tripId}`);
  await page.getByRole('button', { name: 'Xác nhận xe đến', exact: true }).click();
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `/api/v1/line-haul/trips/${tripId}/arrive` &&
        candidate.request().method() === 'POST',
    ),
    page
      .getByRole('dialog', { name: 'Xác nhận arrival' })
      .getByRole('button', { name: 'Xác nhận xe đến', exact: true })
      .click(),
  ]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ data: { status: 'ARRIVED' } });
  await expect(page.getByText('Đã đến kho đích', { exact: true })).toBeVisible();
  await page.goto('/warehouse/workspace');
}

export async function runDestinationWarehouseFlow(page: Page, trackingCode: string): Promise<void> {
  await page.getByRole('tab', { name: /^Chuyển đến/ }).click();
  const inboundPanel = page.getByRole('tabpanel', { name: /Chuyển đến/ });
  const inboundRow = inboundPanel.locator('tr', { hasText: trackingCode });
  await expect(inboundRow).toBeVisible();
  await expect(inboundRow.getByText('Đang trung chuyển', { exact: true }).first()).toBeVisible();
  await inboundRow.getByRole('button', { name: 'Nhập kho đích' }).click();
  const receiveDialog = page.getByRole('dialog', { name: /Nhận trung chuyển/ });
  await receiveDialog.getByLabel('Cân lại tại kho đích (gram, tùy chọn)').fill('2120');
  await receiveDialog.getByLabel('Ghi chú khi nhận').fill('Đã nhận đủ hàng');
  await receiveDialog.getByRole('button', { name: 'Xác nhận nhập kho đích' }).click();
  await expect(page.getByText(/Đã tiếp nhận chuyến trung chuyển.*vào kho đích/)).toBeVisible();

  const inventoryPanel = page.getByRole('tabpanel', { name: /Tồn kho/ });
  const inventoryRow = inventoryPanel.locator('tr', { hasText: trackingCode });
  await expect(inventoryRow.getByText('Tại kho đích', { exact: true })).toBeVisible();
  await inventoryRow.getByRole('button', { name: 'Sẵn sàng giao' }).click();
  await expect(
    page.getByText(new RegExp(`${trackingCode}.*sẵn sàng điều phối giao hàng`)),
  ).toBeVisible();
  await expect(inventoryPanel.getByText('Chờ phân công giao hàng', { exact: true })).toBeVisible();
}
