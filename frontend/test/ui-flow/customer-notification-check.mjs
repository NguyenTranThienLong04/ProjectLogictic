import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { customerNotificationTypes } from './customer-notification-fixtures.mjs';

const uuid = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
const contact = { contactName: 'Customer fixture', phone: '0901234567', streetAddress: '123 Test', ward: 'Test', district: '', city: 'Test' };
const shipment = (id) => ({
  id, trackingCode: `SHP-${id.slice(-4)}`, status: 'DELIVERED', createdAt: now, updatedAt: now,
  pickup: contact, delivery: contact, codAmount: 0, canCancel: false, timeline: [],
  package: { description: 'Customer parcel', packageType: 'PARCEL', weightGrams: 1000, lengthCm: 20, widthCm: 15, heightCm: 10 },
  pricing: { baseFee: 30000, distanceFee: 0, weightFee: 0, codFee: 0, surcharge: 0, discount: 0, totalFee: 30000 },
  shippingFee: { id: uuid(50), status: 'COLLECTED', payer: 'SENDER', expectedAmount: 30000, collectedAmount: 30000 },
});

// Actual App/router/pages and HTTP fixtures. Server ownership is tested separately in Nest.
export async function checkCustomerNotifications(browser, origin) {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [], unexpected = [], detailReads = [], readRequests = [];
    let notification, readMode = 'success', releaseRead, denyDetail = false, refreshes = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/socket.io/**', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data;
      if (path.endsWith('/auth/refresh')) {
        refreshes++;
        data = { accessToken: 'local-http-fixture-token', expiresIn: 900, user: { id: uuid(1), role: 'CUSTOMER', status: 'ACTIVE', fullName: 'Customer fixture', email: 'customer@example.test', mustChangePassword: false } };
      } else if (path.endsWith('/notifications')) {
        data = { items: [notification], page: 1, limit: 12, total: 1, totalPages: 1, unreadCount: notification.readAt ? 0 : 1 };
      } else if (path.endsWith('/read')) {
        readRequests.push(path);
        const current = notification;
        if (readMode === 'pending') await new Promise((resolve) => { releaseRead = resolve; });
        if (readMode === 'failure') return route.fulfill({ status: 503, json: { message: 'Read temporarily unavailable' } });
        current.readAt = now;
        data = current;
      } else if (path.startsWith('/api/v1/shipping-fee-payments/shipments/')) {
        data = { availableActions: { createPayment: false }, unavailableReason: null, payment: null };
      } else if (path === '/api/v1/shipments') {
        data = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };
      } else if (path.startsWith('/api/v1/shipments/')) {
        detailReads.push(path);
        if (denyDetail) return route.fulfill({ status: 404, json: { code: 'SHIPMENT_NOT_FOUND', message: 'Shipment was not found' } });
        data = shipment(path.split('/').at(-1));
      } else { unexpected.push(path); return route.abort(); }
      await route.fulfill({ json: { data, meta: {} } });
    });
    const setNotification = (type, data, readAt = null) => {
      notification = { id: uuid(11), eventKey: uuid(11), type, title: `Customer ${type}`, message: 'Open shipment update', data, readAt, createdAt: now };
    };
    const open = async (entry) => {
      await page.goto(origin + (entry === 'dropdown' ? '/shipments' : '/notifications'));
      if (entry === 'dropdown') await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
      try {
        await page.getByRole('button', { name: new RegExp(`^${notification.title}`) }).click({ timeout: 2500 });
      } catch (error) {
        await page.screenshot({ path: `test-results/notification-linehaul/customer-open-failure-${width}-${entry}.png` });
        console.error(JSON.stringify({ entry, width, readMode, type: notification.type, url: page.url(), errors, unexpected }));
        throw error;
      }
    };
    try {
      for (const entry of ['dropdown', 'center']) {
        for (const [index, [type, metadata]] of customerNotificationTypes.entries()) {
          const shipmentId = uuid(100 + index);
          setNotification(type, { ...metadata, shipmentId });
          await open(entry);
          await expect(page).toHaveURL(`${origin}/shipments/${shipmentId}`);
          await expect(page.getByRole('heading', { name: shipment(shipmentId).trackingCode, exact: true })).toBeVisible();
          await expect.poll(() => notification.readAt).toBeTruthy();
          const readsBefore = detailReads.length, refreshesBefore = refreshes;
          await page.reload();
          await expect(page).toHaveURL(`${origin}/shipments/${shipmentId}`);
          await expect(page.getByRole('heading', { name: shipment(shipmentId).trackingCode, exact: true })).toBeVisible();
          assert(refreshes > refreshesBefore && detailReads.length > readsBefore, 'F5 must restore auth and read detail from URL');
          assert.equal(detailReads.at(-1), `/api/v1/shipments/${shipmentId}`);
        }
        for (const mode of ['pending', 'failure', 'already-read']) {
          readMode = mode;
          setNotification('DELIVERY_DRIVER_ASSIGNED', { shipmentId: uuid(200), assignmentId: uuid(22) }, mode === 'already-read' ? now : null);
          const readsBefore = readRequests.length;
          await open(entry);
          await expect(page).toHaveURL(`${origin}/shipments/${uuid(200)}`, { timeout: 1500 });
          await expect(page.getByRole('heading', { name: shipment(uuid(200)).trackingCode, exact: true })).toBeVisible();
          if (mode === 'pending') {
            assert.equal(notification.readAt, null, 'navigation completed while mark-read was held open');
            await expect.poll(() => typeof releaseRead).toBe('function');
            releaseRead(); releaseRead = undefined;
            await expect.poll(() => notification.readAt).toBeTruthy();
          } else if (mode === 'failure') {
            await expect(page.getByText(/Thông báo chưa được đánh dấu đã đọc/)).toBeVisible();
            assert.equal(notification.readAt, null);
          } else assert.equal(readRequests.length, readsBefore, 'already-read click must not PATCH again');
        }
        readMode = 'success';
        for (const data of [null, {}, { assignmentId: uuid(22) }, { shipmentId: '../admin/dashboard', url: '/admin/dashboard' }]) {
          setNotification('DELIVERY_DRIVER_ASSIGNED', data);
          const readsBefore = detailReads.length;
          await open(entry);
          await expect(page).toHaveURL(`${origin}/shipments`);
          await expect(page.getByRole('heading', { name: 'Vận đơn của tôi', exact: true })).toBeVisible();
          assert.equal(detailReads.length, readsBefore, 'invalid metadata must not fetch a detail');
        }
        setNotification('UNKNOWN_EVENT', { shipmentId: uuid(200), url: '/driver/assignments', role: 'DRIVER' });
        await open(entry);
        await expect(page).toHaveURL(`${origin}/shipments`);
        denyDetail = true;
        setNotification('SHIPMENT_CREATED', { shipmentId: uuid(999) });
        await open(entry);
        await expect(page.getByRole('heading', { name: 'Không thể tải chi tiết vận đơn', exact: true })).toBeVisible();
        await page.reload();
        await expect(page).toHaveURL(`${origin}/shipments/${uuid(999)}`);
        await expect(page.getByRole('heading', { name: 'Không thể tải chi tiết vận đơn', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: shipment(uuid(999)).trackingCode, exact: true })).toHaveCount(0);
        denyDetail = false;
        console.log(`PASS Customer ${width}px ${entry}: all 11 types + F5, pending/failed/already-read, fallback, rejected detail`);
      }
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    } finally { releaseRead?.(); await context.close(); }
  }
}

export async function checkOtherNotificationRoles(browser, origin) {
  for (const role of ['ADMIN', 'DISPATCHER']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let readAt = null;
    const unexpected = [], errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/socket.io/**', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const notification = { id: uuid(11), type: 'PICKUP_ASSIGNMENT_REJECTED', title: 'Reassign pickup', data: { shipmentId: uuid(100), assignmentId: uuid(21) }, readAt, createdAt: now, message: 'Dispatcher update' };
      let data;
      if (path.endsWith('/auth/refresh')) data = { accessToken: 'local-http-fixture-token', expiresIn: 900, user: { id: uuid(1), role, status: 'ACTIVE', fullName: role, email: 'operator@example.test', mustChangePassword: false } };
      else if (path.endsWith('/notifications')) data = { items: [notification], page: 1, total: 1, totalPages: 1, unreadCount: readAt ? 0 : 1 };
      else if (path.endsWith('/read')) { readAt = now; data = { ...notification, readAt }; }
      else { unexpected.push(path); return route.abort(); }
      await route.fulfill({ json: { data, meta: {} } });
    });
    try {
      await page.goto(`${origin}/notifications`);
      await expect(page.getByRole('heading', { name: 'Reassign pickup' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reassign pickup' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Đánh dấu đã đọc', exact: true }).click();
      await expect.poll(() => readAt).toBeTruthy();
      readAt = null;
      await page.reload();
      await page.locator('summary').filter({ hasText: 'Thông báo' }).click();
      await page.getByRole('button', { name: /^Reassign pickup/ }).click();
      await expect.poll(() => readAt).toBeTruthy();
      await expect(page).toHaveURL(`${origin}/notifications`);
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      console.log(`PASS ${role}: existing center mark-read and dropdown behavior preserved`);
    } finally { await context.close(); }
  }
}
