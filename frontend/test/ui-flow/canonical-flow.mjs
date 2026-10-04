import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Real production components; HTTP/tiles mocked, no staging or DB claim.
const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/canonical-flow', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4198, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
const now = new Date().toISOString();
const origin = { id: 'origin', code: 'A', name: 'Kho nguồn', isActive: true };
const destination = { id: 'destination', code: 'B', name: 'Kho đích', isActive: true };
const base = { id: 'transfer', transferCode: 'TRF-TEST', fromWarehouseId: origin.id, toWarehouseId: destination.id,
  fromWarehouse: origin, toWarehouse: destination, createdAt: now, shipment: { trackingCode: 'SHP-TEST', status: 'AT_ORIGIN_WAREHOUSE' },
  workflow: { lineHaulRequired: true, enforcementFrom: now, canStandaloneDispatch: false, canReceive: false, legacyStandalone: false }, status: 'PENDING' };
try {
  await mkdir('test-results/canonical-flow', { recursive: true });
  browser = await chromium.launch();
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], unexpected = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
    let transfer = structuredClone(base), gps = true, legacy = false, detailReads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url()), path = url.pathname;
      let data;
      if (route.request().method() !== 'GET') { unexpected.push(path); return route.abort(); }
      if (path.endsWith('/notifications')) data = { items: [], total: 0, totalPages: 1, unreadCount: 0 };
      else if (path.endsWith('/staff/me')) data = { warehouseId: origin.id, warehouse: origin, user: { fullName: 'Warehouse Staff' } };
      else if (path.endsWith('/warehouses')) data = { items: [origin, destination], pagination: { totalPages: 1 } };
      else if (path.endsWith('/inbound-queue')) data = { pickedUpShipments: [], incomingTransfers: [] };
      else if (path.endsWith('/shipments')) data = { items: [], pagination: { totalPages: 1 } };
      else if (path.endsWith('/transfers')) data = [transfer];
      else if (path.endsWith('/driver/location')) data = gps ? { driverId: 'driver', latitude: 10.775, longitude: 106.704, updatedAt: new Date().toISOString() } : null;
      else if (path.includes('/delivery-assignments/')) {
        detailReads++;
        data = { id: 'assignment', status: 'ACCEPTED', shipmentStatus: 'OUT_FOR_DELIVERY', trackingCode: 'SHP-TEST', assignedAt: now,
          delivery: { contactName: 'Người nhận', phone: '0901234567', streetAddress: '123 Nguyễn Trãi', ward: 'Bến Thành', district: '', city: 'Hồ Chí Minh' },
          receiver: { fullName: 'Người nhận', phone: '0901234567' },
          attempt: { attemptNumber: 1, status: 'OUT_FOR_DELIVERY' }, availableActions: { collectShippingFee: false },
          codAmount: 0, shippingFee: { payer: 'SENDER', status: 'COLLECTED', expectedAmount: 30000 },
          taskLocation: { kind: 'RECEIVER', label: 'Điểm giao · Người nhận', address: '123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh',
            latitude: legacy ? null : 10.769508, longitude: legacy ? null : 106.690795 },
        };
      } else { unexpected.push(path); return route.abort(); }
      await route.fulfill({ json: { data, meta: {} } });
    });
    const open = (screen = '/warehouse/workspace') => page.goto(`http://127.0.0.1:4198/test/ui-flow/index.html?screen=${encodeURIComponent(screen)}`);
    const outbound = () => page.getByRole('tab', { name: /Chuyển đi/ }).click();
    const inbound = () => page.getByRole('tab', { name: /Chuyển đến/ }).click();
    await open();
    await page.screenshot({ path: `test-results/canonical-flow/initial-${width}.png` });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await outbound();
    await expect(page.getByText('Đang chờ điều phối chuyến trung chuyển', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dispatch / xuất kho' })).toHaveCount(0);
    await page.getByRole('tabpanel').screenshot({ path: `test-results/canonical-flow/warehouse-pending-${width}.png` });
    transfer.lineHaulTrip = { id: 'trip', tripCode: 'TRIP-TEST', status: 'READY', scheduledStartAt: now,
      vehicle: { vehicleCode: 'TRUCK-01', licensePlate: '51C-12345' }, driver: { employeeCode: 'LH-01', fullName: 'Tài xế liên kho' } };
    await open(); await outbound();
    await expect(page.getByText('Xe: TRUCK-01 · 51C-12345')).toBeVisible();
    await expect(page.getByText('Tài xế: Tài xế liên kho')).toBeVisible();
    await expect(page.getByText(/Khởi hành:/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dispatch / xuất kho' })).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('tabpanel').screenshot({ path: `test-results/canonical-flow/warehouse-trip-${width}.png` });
    transfer.status = 'IN_TRANSIT'; transfer.lineHaulTrip.status = 'IN_TRANSIT';
    await open(); await inbound();
    await expect(page.getByRole('button', { name: 'Nhập kho đích' })).toHaveCount(0);
    transfer.lineHaulTrip.status = 'ARRIVED'; transfer.workflow.canReceive = true;
    await open(); await inbound();
    await expect(page.getByRole('button', { name: 'Nhập kho đích' })).toBeVisible();
    transfer.lineHaulTrip = null; transfer.workflow.legacyStandalone = true;
    await open(); await inbound();
    await expect(page.getByRole('button', { name: 'Nhập kho đích' })).toBeVisible();
    transfer = { ...structuredClone(base), workflow: { ...base.workflow, lineHaulRequired: false, canStandaloneDispatch: true } };
    await open(); await outbound();
    await expect(page.getByRole('button', { name: 'Dispatch / xuất kho' })).toBeVisible();

    await open('/driver/deliveries/assignment');
    await page.screenshot({ path: `test-results/canonical-flow/driver-initial-${width}.png` });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    const map = page.getByRole('region', { name: /Bản đồ đến người nhận:/ });
    await expect(map.locator('path.leaflet-interactive')).toHaveCount(2);
    const legend = page.getByRole('list', { name: 'Chú thích bản đồ' });
    await expect(legend.getByRole('listitem')).toHaveCount(2);
    await expect(legend).toContainText('Điểm giao · Người nhận');
    await page.locator('.driver-task-map').screenshot({ path: `test-results/canonical-flow/driver-two-markers-${width}.png` });
    await page.reload();
    await expect(map.locator('path.leaflet-interactive')).toHaveCount(2);
    assert(detailReads >= 2);
    gps = false; await page.reload();
    await expect(map.locator('path.leaflet-interactive')).toHaveCount(1);
    await expect(legend).toContainText('Điểm giao · Người nhận');
    legacy = true; await page.reload();
    await expect(page.getByText(/Điểm đến chưa có tọa độ chính xác/)).toBeVisible();
    await expect(page.getByText('Chưa thể đặt ghim trên bản đồ', { exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${width}: strict/compatibility Warehouse actions, trip resources, arrival/legacy receive; distinct Driver and destination markers, reload, no GPS, legacy null`);
    await page.close();
  }
} finally { await browser?.close(); await server.httpServer.close(); }
