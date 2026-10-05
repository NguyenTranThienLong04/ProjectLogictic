import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Real App, AuthProvider, role routes and detail components. HTTP fixtures only; no staging claim.
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = { root, configFile: `${root}/vite.config.ts`, logLevel: 'error',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/control-tower' }, preview: { host: '127.0.0.1', port: 4201, strictPort: true } };
await build(config);
const server = await preview(config);
const base = 'http://127.0.0.1:4201';
const uuid = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-06T12:00:00.000Z';
const origin = { id: uuid(1), code: 'SG01', name: 'Kho Sài Gòn', address: 'Test', city: 'Test', isActive: true };
const destination = { ...origin, id: uuid(2), code: 'HN01', name: 'Kho Hà Nội' };
const policy = { version: 'operational-v1', durationMinutes: { PICKUP: 480, ORIGIN_DWELL: 720, TRANSIT: 1440, DESTINATION_DWELL: 720, DELIVERY: 480 }, atRiskPercent: 80, agingAlertMinutes: 360 };
const filters = { statuses: ['AT_ORIGIN_WAREHOUSE', 'IN_TRANSIT', 'DELIVERY_FAILED', 'PLANNED', 'READY'],
  stages: ['PICKUP', 'ORIGIN_DWELL', 'TRANSIT', 'DELIVERY_FAILED', 'PLANNED', 'READY'], slaStates: ['ON_TIME', 'AT_RISK', 'OVERDUE', 'UNAVAILABLE'], policy };
const item = { id: uuid(3), entityType: 'SHIPMENT', code: 'SHP-OVERDUE', status: 'IN_TRANSIT', stage: 'TRANSIT', createdAt: '2026-10-04T05:00:00Z',
  stageStartedAt: '2026-10-05T10:00:00Z', agingSeconds: 93600, timestampSource: 'LIFECYCLE', timestampQuality: 'VALID',
  deadline: '2026-10-06T10:00:00Z', atRiskAt: '2026-10-06T06:00:00Z', slaState: 'OVERDUE', isAging: true, exception: null, priority: 0,
  originWarehouseId: origin.id, destinationWarehouseId: destination.id, currentWarehouseId: null,
  originWarehouseCode: origin.code, destinationWarehouseCode: destination.code, currentWarehouseCode: null,
  transferId: uuid(4), transferCode: 'TRF-EXACT', transferWarehouseId: origin.id, tripId: uuid(5), tripCode: 'LHT-EXACT' };
const items = [item,
  { ...item, id: uuid(6), code: 'SHP-AT-RISK', status: 'AT_ORIGIN_WAREHOUSE', stage: 'ORIGIN_DWELL', slaState: 'AT_RISK',
    stageStartedAt: '2026-10-06T02:00:00Z', deadline: '2026-10-06T14:00:00Z', atRiskAt: '2026-10-06T11:36:00Z',
    agingSeconds: 36000, priority: 1, transferId: null, tripId: null },
  { ...item, id: uuid(7), code: 'SHP-MISSING-TIME', status: 'DELIVERY_FAILED', stage: 'DELIVERY_FAILED', slaState: null,
    stageStartedAt: null, deadline: null, atRiskAt: null, agingSeconds: null, isAging: false, timestampQuality: 'MISSING', exception: 'DELIVERY_FAILED', priority: 3, transferId: null, tripId: null },
  { ...item, id: uuid(5), entityType: 'TRIP', code: 'LHT-EXACT', status: 'IN_TRANSIT', transferId: null, transferCode: null },
  { ...item, id: uuid(11), code: 'SHP-ON-TIME', status: 'PICKUP_ASSIGNED', stage: 'PICKUP', slaState: 'ON_TIME',
    stageStartedAt: '2026-10-06T10:00:00Z', deadline: '2026-10-06T18:00:00Z', atRiskAt: '2026-10-06T16:24:00Z',
    agingSeconds: 7200, isAging: false, priority: 4, transferId: null, tripId: null },
].sort((a, b) => a.priority - b.priority);
const summary = { activeShipments: 32, pickup: 4, originWarehouse: 8, inTransit: 10, destinationWarehouse: 4, outForDelivery: 3,
  exceptions: 3, overdue: 7, atRisk: 5, aging: 13, unavailableSla: 3, activeTrips: 4, overdueTrips: 1 };
const transfer = { id: uuid(4), transferCode: 'TRF-EXACT', shipmentId: uuid(3), status: 'IN_TRANSIT', fromWarehouseId: origin.id,
  toWarehouseId: destination.id, fromWarehouse: origin, toWarehouse: destination, createdAt: now, dispatchedAt: now, receivedAt: null,
  note: null, shipment: { id: uuid(3), trackingCode: 'SHP-OVERDUE', status: 'IN_TRANSIT' }, lineHaulTrip: { id: uuid(5), tripCode: 'LHT-EXACT', status: 'IN_TRANSIT' } };
const contact = { fullName: 'Test Contact', phone: '0901234567', streetAddress: '123 Test', ward: 'Test', district: '', city: 'Test' };
const shipment = { id: uuid(3), trackingCode: 'SHP-OVERDUE', status: 'IN_TRANSIT', createdAt: now, pickup: contact, delivery: contact,
  sender: contact, receiver: contact, package: { description: 'Test package', packageType: 'PARCEL', weightGrams: 1000, lengthCm: 10, widthCm: 10, heightCm: 10 },
  originWarehouse: origin, destinationWarehouse: destination, codAmount: 0, shippingFee: { payer: 'SENDER', status: 'COLLECTED', expectedAmount: 30000 } };
const trip = { id: uuid(5), tripCode: 'LHT-EXACT', status: 'ARRIVED', createdAt: now, updatedAt: now, version: 2,
  originWarehouse: origin, destinationWarehouse: destination, originWarehouseId: origin.id, destinationWarehouseId: destination.id,
  driver: { id: uuid(8), fullName: 'Tài xế liên kho', employeeCode: 'DRV-TEST' }, vehicle: { id: uuid(9), vehicleCode: 'VEH-TEST', licensePlate: '51C-12345', vehicleType: 'TRUCK', capacityWeightGrams: 1000000, status: 'AVAILABLE' },
  scheduledStartAt: null, scheduledEndAt: null, departedAt: now, arrivedAt: now, plannedRoute: null, remainingRoute: null, currentRoute: null, routeHistory: [],
  manifest: { totalTransfers: 0, receivedTransfers: 0, manifestWeightGrams: 0, vehicleCapacityWeightGrams: 1000000, remainingCapacityWeightGrams: 1000000,
    capacityUtilizationPercent: 0, preparedManifestWeightGrams: null, preparedVehicleCapacityWeightGrams: null }, availableActions: {}, transferAssignments: [] };
let browser;
try {
  await mkdir('test-results/control-tower', { recursive: true });
  browser = await chromium.launch();
  for (const role of ['admin', 'dispatcher']) for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], unexpected = [], calls = [], reads = [];
    let mode = 'normal';
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/socket.io/**', (route) => route.abort());
    await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url()), path = url.pathname;
      let data;
      if (path.endsWith('/auth/refresh')) data = { accessToken: 'fixture-token', expiresIn: 900, user: { id: uuid(10), role: role.toUpperCase(), status: 'ACTIVE', fullName: 'Điều hành thử nghiệm', email: 'ops@example.test', mustChangePassword: false } };
      else if (route.request().method() !== 'GET') { unexpected.push(path); return route.abort(); }
      else if (path.endsWith('/notifications')) data = { items: [], unreadCount: 0, total: 0, totalPages: 0 };
      else if (path.endsWith('/control-tower/filters')) data = filters;
      else if (path.endsWith('/control-tower')) {
        calls.push(url.searchParams);
        if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Control Tower tạm thời không khả dụng' } });
        if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 1000));
        data = { asOf: now, policy, summary, items: mode === 'empty' ? [] : items,
          pagination: { page: Number(url.searchParams.get('page') ?? 1), limit: Number(url.searchParams.get('limit') ?? 25), total: mode === 'empty' ? 0 : 32, totalPages: mode === 'empty' ? 0 : 2 } };
      } else if (path.endsWith('/warehouses')) data = { items: [origin, destination], pagination: { page: 1, totalPages: 1, total: 2, limit: 25 } };
      else if (path === `/api/v1/warehouses/${origin.id}`) data = origin;
      else if (path === `/api/v1/warehouses/${origin.id}/transfers/${transfer.id}`) { data = transfer; reads.push(path); }
      else if (path === `/api/v1/dispatcher/shipments/${shipment.id}`) { data = shipment; reads.push(path); }
      else if (path === `/api/v1/line-haul/trips/${trip.id}`) { data = trip; reads.push(path); }
      else if (path === `/api/v1/line-haul/trips/${trip.id}/location`) data = null;
      else { unexpected.push(path); return route.abort(); }
      return route.fulfill({ json: { data, meta: {} } });
    });
    const path = `/${role}/control-tower`;
    const open = () => page.goto(base + path);
    await open();
    await expect(page.getByRole('heading', { name: 'Control Tower', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('SHP-OVERDUE');
    await expect(page.getByRole('table')).toContainText('26h 00m');
    await expect(page.getByRole('table')).toContainText('Sắp quá SLA');
    await expect(page.getByRole('table')).toContainText('Đúng hạn');
    await expect(page.getByRole('table')).toContainText('Chưa xác định SLA');
    await expect(page.getByRole('table')).toContainText('Thiếu mốc thời gian');
    await page.screenshot({ path: `test-results/control-tower/${role}-${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
    if (process.argv.includes('--screenshots-only')) {
      console.log(`PASS ${role} ${width}px: screenshots and ON_TIME/AT_RISK/OVERDUE/missing-time rendering`);
      await context.close();
      continue;
    }
    await page.getByLabel('Tự cập nhật mỗi 60 giây').uncheck();
    await page.getByLabel('Sắp xếp', { exact: true }).selectOption('AGING_DESC');
    await expect.poll(() => calls.at(-1)?.get('sort')).toBe('AGING_DESC');
    if (width === 1440) await expect(page.locator('th[aria-sort="descending"]')).toContainText('Aging');
    await page.getByRole('button', { name: 'Sau', exact: true }).click();
    await expect.poll(() => calls.at(-1)?.get('page')).toBe('2');
    await page.getByLabel('SLA', { exact: true }).selectOption('OVERDUE');
    await page.getByLabel('Kho liên quan').selectOption(origin.id);
    await page.getByLabel('Trạng thái', { exact: true }).selectOption('IN_TRANSIT');
    await page.getByLabel('Đối tượng', { exact: true }).selectOption('SHIPMENT');
    await page.getByLabel('Mã shipment / transfer / trip').fill('SHP');
    await page.getByLabel('Tạo từ (giờ thiết bị)').fill('2026-10-01T08:30');
    await page.getByLabel('Tạo trước (giờ thiết bị)').fill('2026-10-07T08:30');
    await page.getByRole('button', { name: 'Áp dụng bộ lọc' }).click();
    await expect.poll(() => calls.at(-1)?.get('slaState')).toBe('OVERDUE');
    const sent = calls.at(-1);
    assert.equal(sent.get('warehouseId'), origin.id); assert.equal(sent.get('status'), 'IN_TRANSIT');
    assert.equal(sent.get('entityType'), 'SHIPMENT'); assert.equal(sent.get('page'), '1');
    assert.equal(sent.get('from'), '2026-10-01T01:30:00.000Z');
    await page.reload();
    await expect(page.getByLabel('SLA', { exact: true })).toHaveValue('OVERDUE');
    await expect(page.getByLabel('Kho liên quan')).toHaveValue(origin.id);
    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await expect(page).toHaveURL(base + path);
    for (const [code, target, apiPath] of [
      ['SHP-OVERDUE', `/${role}/shipments/${shipment.id}`, `/api/v1/dispatcher/shipments/${shipment.id}`],
      ['TRF-EXACT', `/${role}/warehouses/${origin.id}/transfers/${transfer.id}`, `/api/v1/warehouses/${origin.id}/transfers/${transfer.id}`],
      ['LHT-EXACT', role === 'admin' ? `/admin/line-haul/trips/${trip.id}` : `/dispatcher/line-haul/${trip.id}`, `/api/v1/line-haul/trips/${trip.id}`],
    ]) {
      await page.getByRole('link', { name: code, exact: true }).first().click();
      await expect(page).toHaveURL(base + target);
      await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
      const previousReads = reads.filter((read) => read === apiPath).length;
      await page.reload();
      await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
      assert(reads.filter((read) => read === apiPath).length > previousReads, 'F5 refetches exact record');
      await open(); await expect(page.getByRole('table')).toContainText('SHP-OVERDUE');
    }
    mode = 'loading'; await page.reload();
    await expect(page.getByText('Đang tải Control Tower', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('table')).toContainText('SHP-OVERDUE');
    mode = 'empty'; await page.reload();
    await expect(page.getByRole('heading', { name: 'Không có shipment / trip phù hợp' })).toBeVisible();
    mode = 'error'; await page.reload();
    await expect(page.getByText('Control Tower tạm thời không khả dụng', { exact: true })).toBeVisible();
    await expect(page.getByText('Snapshot:', { exact: false })).toHaveCount(0);
    mode = 'normal'; await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('SHP-OVERDUE');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${role} ${width}px: rendering, filters/UTC/F5, sort/page, 3 exact details/F5, loading/empty/error/retry`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
