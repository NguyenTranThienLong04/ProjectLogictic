import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const baseline = process.argv.includes('--baseline');
const config = {
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { outDir: '.vite/ui-flow', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
  preview: { host: '127.0.0.1', port: 4197, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
const now = '2026-10-03T08:00:00Z';
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = { id: uuid(1), code: 'ORIGIN', name: 'Kho xuất', city: 'Hà Nội', isActive: true };
const destA = { id: uuid(2), code: 'DEST-A', name: 'Kho đích cũ', city: 'Đà Nẵng', isActive: true };
const destB = { id: uuid(3), code: 'DEST-B', name: 'Kho đích hiện tại', city: 'Huế', isActive: true };
const contact = { contactName: 'Test', fullName: 'Test', phone: '0901234567', streetAddress: '123 Test', ward: 'Test', district: '', city: 'Hà Nội' };
const makeShipment = () => ({ id: uuid(4), trackingCode: 'SHP-UI-FLOW', status: 'AT_ORIGIN_WAREHOUSE', originWarehouseId: origin.id,
  currentWarehouseId: origin.id, destinationWarehouseId: destA.id, destinationWarehouse: destA,
  originWarehouse: origin, currentWarehouse: origin, senderSnapshot: contact, receiverSnapshot: contact,
  pickupSnapshot: contact, deliverySnapshot: contact, totalFee: 30000, codAmount: 0,
  packageSnapshot: { description: 'Kiện thử', packageType: 'PARCEL', weightGrams: 1000, lengthCm: 20, widthCm: 14.8, heightCm: 10 } });
try {
  await mkdir('test-results/ui-flow', { recursive: true });
  browser = await chromium.launch();
  for (const width of baseline ? [1440] : [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], transfers = [], checkIns = [], reads = [], detailReads = [];
    let shipment = makeShipment(), activeTransfers = [], lookupError = false, readError = false, raceOnPost = false;
    let readGate, releaseRead;
    const notifications = [
      { id: uuid(11), type: 'PICKUP_ASSIGNMENT_CREATED', title: 'Nhiệm vụ lấy hàng mới', data: { assignmentId: uuid(21), shipmentId: shipment.id } },
      { id: uuid(12), type: 'DELIVERY_ASSIGNMENT_CREATED', title: 'Nhiệm vụ giao hàng mới', data: { assignmentId: uuid(22), shipmentId: shipment.id } },
      { id: uuid(13), type: 'DELIVERY_ASSIGNMENT_CREATED', title: 'Giao hàng thiếu ID', data: { shipmentId: shipment.id } },
      { id: uuid(14), type: 'GENERAL', title: 'Thông báo chung', data: null },
      { id: uuid(15), type: 'PICKUP_ASSIGNMENT_CREATED', title: 'Lấy hàng thiếu ID', data: { shipmentId: shipment.id } },
      { id: uuid(16), type: 'PICKUP_ASSIGNMENT_CREATED', title: 'Lấy hàng ID lỗi', data: { assignmentId: '../invalid' } },
    ].map((n) => ({ ...n, eventKey: n.id, message: 'Mở nhiệm vụ', readAt: null, createdAt: now }));
    page.on('pageerror', (e) => { errors.push(e.message); console.error('Browser error:', e.message); });
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      let data;
      if (path.endsWith('/notifications')) data = { items: notifications, page: 1, totalPages: 1, unreadCount: notifications.filter((n) => !n.readAt).length };
      else if (path.endsWith('/read')) {
        if (readGate) await readGate;
        if (readError) return route.fulfill({ status: 503, json: { message: 'Không thể đánh dấu đã đọc. Thử lại.' } });
        data = notifications.find((n) => path.includes(n.id)); data.readAt = now; reads.push(data.id);
      } else if (path.endsWith('/staff/me')) data = { warehouseId: origin.id, warehouse: origin, user: { fullName: 'Test Staff' } };
      else if (path.endsWith('/warehouses')) data = { items: [origin, destA, destB], pagination: { totalPages: 1 } };
      else if (path.endsWith('/inbound-queue')) data = { pickedUpShipments: shipment.status === 'PICKED_UP' ? [shipment] : [], incomingTransfers: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } };
      else if (path.endsWith('/shipments')) {
        if (lookupError && url.searchParams.has('search')) return route.fulfill({ status: 503, json: { message: 'Lỗi tải dữ liệu' } });
        data = { items: shipment.currentWarehouseId === origin.id ? [shipment] : [], pagination: { totalPages: 1 } };
      } else if (path.endsWith('/route-destination')) {
        shipment.destinationWarehouseId = req.postDataJSON().destinationWarehouseId;
        shipment.destinationWarehouse = [origin, destA, destB].find((w) => w.id === shipment.destinationWarehouseId); data = shipment;
      } else if (path.endsWith('/transfers') && req.method() === 'POST') {
        const body = req.postDataJSON(); transfers.push(body);
        if (raceOnPost) {
          raceOnPost = false;
          shipment.destinationWarehouseId = destB.id; shipment.destinationWarehouse = destB;
        }
        if (body.toWarehouseId !== shipment.destinationWarehouseId) return route.fulfill({ status: 409, json: { code: 'TRANSFER_DESTINATION_MISMATCH', message: 'Transfer destination must match the shipment sorting destination' } });
        data = { id: uuid(30), transferCode: 'TRF-TEST', ...body, status: 'PENDING', shipment, fromWarehouse: origin, toWarehouse: shipment.destinationWarehouse, createdAt: now };
        activeTransfers = [data];
      } else if (path.endsWith('/transfers')) {
        const items = url.searchParams.get('direction') === 'outbound' ? activeTransfers.filter((item) =>
          (!url.searchParams.has('status') || item.status === url.searchParams.get('status')) &&
          (!url.searchParams.has('shipmentId') || item.shipmentId === url.searchParams.get('shipmentId'))) : [];
        data = { items, total: items.length, page: 1, limit: 20, totalPages: items.length ? 1 : 0 };
      }
      else if (path.endsWith('/check-in') && req.method() === 'POST') {
        checkIns.push(req.postDataJSON()); shipment.status = 'AT_ORIGIN_WAREHOUSE'; shipment.currentWarehouseId = origin.id; data = { shipment, idempotent: false };
      } else if (path.includes('/assignments/') || path.includes('/delivery-assignments/')) {
        detailReads.push(path);
        data = { id: path.split('/').at(-1), status: 'COMPLETED', shipmentStatus: 'DELIVERED', trackingCode: 'SHP-TASK',
          pickup: contact, delivery: contact, receiver: contact, assignedAt: now, proofs: [], codAmount: 0,
          shippingFee: { status: 'COLLECTED', payer: 'SENDER', expectedAmount: 30000 },
          taskLocation: { kind: 'PICKUP', label: 'Test', address: '123 Test', coordinate: null } };
      } else if (path.endsWith('/driver/location')) data = { location: null };
      else throw new Error(`Unexpected request ${req.method()} ${path}`);
      await route.fulfill({ json: { data, meta: {} } });
    });
    const goto = (screen = '/warehouse/workspace') => page.goto(`http://127.0.0.1:4197/test/ui-flow/index.html?screen=${encodeURIComponent(screen)}`);
    await goto();
    await page.screenshot({ path: 'test-results/ui-flow/initial.png' });
    await page.getByRole('tab', { name: /Tồn kho/ }).click();
    // Inventory is stale while another operator changes the sorting destination.
    shipment.destinationWarehouseId = destB.id; shipment.destinationWarehouse = destB;
    await page.getByRole('button', { name: 'Tạo transfer', exact: true }).click();
    if (baseline) {
      await expect(page.getByRole('dialog')).toContainText('DEST-A');
      await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
      await expect(page.getByRole('dialog')).toContainText('Transfer destination must match');
      assert.equal(transfers[0].toWarehouseId, destA.id);
      console.log('REPRODUCED: stale transfer label/payload A rejected against database destination B');
      await goto('/driver/assignments');
      await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
      await page.getByRole('button', { name: /Nhiệm vụ lấy hàng mới/ }).click();
      await expect.poll(() => reads.length).toBe(1);
      await expect(page.getByTestId('route')).toHaveText('/driver/assignments');
      console.log('REPRODUCED: notification marks read but does not navigate');
      await page.close(); continue;
    }
    await expect(page.getByRole('dialog')).toContainText('DEST-B');
    await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(transfers[0].toWarehouseId, destB.id);
    await page.screenshot({ path: `test-results/ui-flow/transfer-${width}.png` });

    activeTransfers = []; shipment = makeShipment(); await goto();
    await page.getByRole('tab', { name: /Tồn kho/ }).click();
    await page.getByRole('button', { name: 'Tạo transfer', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('DEST-A');
    shipment.destinationWarehouseId = destB.id; shipment.destinationWarehouse = destB;
    await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
    await expect(page.getByRole('dialog')).toContainText('DEST-B');
    await expect(page.getByRole('dialog')).toContainText('đã thay đổi');
    assert.equal(transfers.length, 1, 'changed route must require another review before POST');
    await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(transfers[1].toWarehouseId, destB.id);

    shipment = makeShipment(); activeTransfers = []; await goto();
    await page.getByRole('tab', { name: /Tồn kho/ }).click();
    shipment.destinationWarehouseId = null; shipment.destinationWarehouse = null;
    await page.getByRole('button', { name: 'Tạo transfer', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Phân loại');
    await expect(page.getByRole('button', { name: 'Tạo transfer chờ xuất' })).toBeDisabled();

    for (const invalid of ['inactive', 'active-transfer', 'gone', 'lookup-error', 'relation-mismatch']) {
      shipment = makeShipment(); activeTransfers = []; lookupError = false; await goto();
      await page.getByRole('tab', { name: /Tồn kho/ }).click();
      if (invalid === 'inactive') shipment.destinationWarehouse = { ...destA, isActive: false };
      if (invalid === 'active-transfer') activeTransfers = [{ id: uuid(31), shipmentId: shipment.id, transferCode: 'TRF-EXISTS', status: 'PENDING' }];
      if (invalid === 'gone') shipment.currentWarehouseId = null;
      if (invalid === 'lookup-error') lookupError = true;
      if (invalid === 'relation-mismatch') shipment.destinationWarehouse = destB;
      await page.getByRole('button', { name: 'Tạo transfer', exact: true }).click();
      const message = { inactive: 'ngừng hoạt động', 'active-transfer': 'TRF-EXISTS', gone: 'không còn trong tồn kho', 'lookup-error': 'Chưa xác minh được kho đích', 'relation-mismatch': 'chưa đồng nhất' }[invalid];
      await expect(page.getByRole('dialog')).toContainText(message);
      await expect(page.getByRole('button', { name: 'Tạo transfer chờ xuất' })).toBeDisabled();
      assert.equal(transfers.length, 2);
      if (invalid === 'lookup-error') {
        lookupError = false;
        await page.getByRole('dialog').getByRole('button', { name: /Thử lại/ }).click();
        await expect(page.getByRole('button', { name: 'Tạo transfer chờ xuất' })).toBeEnabled();
      }
    }

    shipment = makeShipment(); activeTransfers = []; await goto();
    await page.getByRole('tab', { name: /Tồn kho/ }).click();
    await page.getByRole('button', { name: 'Tạo transfer', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('DEST-A');
    raceOnPost = true;
    await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
    await expect(page.getByRole('dialog')).toContainText('Kho đích vừa thay đổi');
    await expect(page.getByRole('dialog')).toContainText('DEST-B');
    await expect(page.getByRole('dialog')).not.toContainText('Transfer destination must match');
    await page.getByRole('button', { name: 'Tạo transfer chờ xuất' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(transfers.at(-1).toWarehouseId, destB.id);

    shipment = makeShipment(); activeTransfers = []; shipment.status = 'PICKED_UP'; shipment.currentWarehouseId = null; await goto();
    await page.getByRole('button', { name: /Kiểm hàng/ }).click();
    await page.getByLabel('Đã đối chiếu kiện thực tế').check();
    await page.getByLabel('Trọng lượng thực tế sau khi cân (gram)').fill('1000.5');
    await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toBeDisabled();
    await page.getByLabel('Trọng lượng thực tế sau khi cân (gram)').fill('1000');
    await page.getByLabel('Rộng (cm)', { exact: true }).fill('14.81');
    await expect(page.getByText('Rộng (cm) chỉ được có tối đa 1 chữ số thập phân')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toBeDisabled();
    await page.getByLabel('Rộng (cm)', { exact: true }).fill('14.8');
    await page.screenshot({ path: `test-results/ui-flow/check-in-${width}.png` });
    await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual([checkIns[0].actualWeightGrams, checkIns[0].lengthCm, checkIns[0].widthCm, checkIns[0].heightCm], [1000,20,14.8,10]);

    for (const screen of ['/driver/assignments', '/notifications']) {
      for (const [index, target] of [[0, `/driver/pickups/${uuid(21)}`], [1, `/driver/deliveries/${uuid(22)}`], [2, '/driver/deliveries'], [3, '/driver/assignments'], [4, '/driver/assignments'], [5, '/driver/assignments']]) {
        await goto(screen);
        if (screen !== '/notifications') await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
        await page.getByRole('button', { name: new RegExp(notifications[index].title) }).click();
        await expect(page.getByTestId('route')).toHaveText(target);
        await expect.poll(() => notifications[index].readAt).toBeTruthy();
        if (index < 2) await expect(page.getByRole('heading', { name: index === 0 ? 'Chi tiết lấy hàng' : 'Chi tiết giao hàng', exact: true })).toBeVisible();
      }
    }
    assert(detailReads.some((path) => path.endsWith(uuid(21))));
    assert(detailReads.some((path) => path.endsWith(uuid(22))));
    assert.equal(reads.length, 6, 'already-read notification still navigates without another PATCH');
    for (const screen of ['/driver/assignments', '/notifications']) {
      notifications[0].readAt = null; readError = true;
      await goto(screen);
      if (screen !== '/notifications') await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
      const task = page.getByRole('button', { name: /Nhiệm vụ lấy hàng mới/ });
      await task.click();
      await expect(page.getByTestId('route')).toHaveText(`/driver/pickups/${uuid(21)}`);
      await expect(page.getByText(/Thông báo chưa được đánh dấu đã đọc/)).toBeVisible();
      assert.equal(notifications[0].readAt, null);
      readError = false;
      await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
      await task.click();
      await expect(page.getByTestId('route')).toHaveText(`/driver/pickups/${uuid(21)}`);
      await expect.poll(() => notifications[0].readAt).toBeTruthy();
    }
    for (const screen of ['/driver/assignments', '/notifications']) {
      for (const index of [0, 1]) {
        notifications[index].readAt = null;
        readGate = new Promise((resolve) => { releaseRead = resolve; });
        await goto(screen);
        if (screen !== '/notifications') await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
        await page.getByRole('button', { name: new RegExp(notifications[index].title) }).click();
        await expect(page.getByTestId('route')).toHaveText(index === 0 ? `/driver/pickups/${uuid(21)}` : `/driver/deliveries/${uuid(22)}`);
        await expect(page.getByRole('heading', { name: index === 0 ? 'Chi tiết lấy hàng' : 'Chi tiết giao hàng', exact: true })).toBeVisible();
        assert.equal(notifications[index].readAt, null, 'task opens while mark-read is still pending');
        releaseRead(); readGate = undefined;
        await expect.poll(() => notifications[index].readAt).toBeTruthy();
      }
    }
    await page.screenshot({ path: `test-results/ui-flow/notifications-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: transfer refresh/review/blocked, decimal check-in, dropdown + notification center deep links/read/fallback`);
    await page.close();
  }
} finally { await browser?.close(); await new Promise((resolve) => server.httpServer.close(resolve)); }
