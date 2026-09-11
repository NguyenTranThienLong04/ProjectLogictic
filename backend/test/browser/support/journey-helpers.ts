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
  await page.getByLabel('Phường / xã').fill('Bến Nghé');
  await page.getByLabel('Quận / huyện').fill('Quận 1');
  await page.getByLabel('Tỉnh / thành phố').fill('Hồ Chí Minh');
  await page.getByText('Thêm ghim tọa độ điểm giao (tùy chọn)').click();
  await page.getByLabel('Vĩ độ').fill('10.7865');
  await page.getByLabel('Kinh độ').fill('106.7045');
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
  await expect(page.getByText(/Đã tạo chuyến.*đang chờ xác nhận xuất kho/)).toBeVisible();

  const outboundPanel = page.getByRole('tabpanel', { name: /Chuyển đi/ });
  const outboundRow = outboundPanel.locator('tr', { hasText: trackingCode });
  await expect(outboundRow.getByText('Chờ xuất kho', { exact: true })).toBeVisible();
  await outboundRow.getByRole('button', { name: 'Dispatch / xuất kho' }).click();
  const dispatchDialog = page.getByRole('dialog', { name: /Xuất kho/ });
  await expect(dispatchDialog.getByText(/Shipment chuyển sang IN_TRANSIT/)).toBeVisible();
  await dispatchDialog.getByRole('button', { name: 'Xác nhận Dispatch' }).click();
  await expect(page.getByText(/kiện hàng đang trung chuyển/)).toBeVisible();
  await expect(outboundPanel.getByText('Đang trung chuyển', { exact: true }).first()).toBeVisible();
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
