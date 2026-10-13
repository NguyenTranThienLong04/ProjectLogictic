import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationTarget } from '../src/features/notifications/notification-target.ts';
import { customerNotificationTypes } from './ui-flow/customer-notification-fixtures.mjs';

const shipmentId = '30000000-0000-4000-8000-000000000001';

for (const [type, metadata] of customerNotificationTypes) {
  test(`Customer ${type} opens the shipment using the actual Customer route`, () => {
    assert.equal(notificationTarget({ type, data: { ...metadata, shipmentId } }, 'CUSTOMER'), `/shipments/${shipmentId}`);
  });
}

test('Customer missing/malformed metadata falls back to the shipment list', () => {
  for (const [type, metadata] of customerNotificationTypes) {
    for (const invalidId of [undefined, null, '', 123, {}, '../bad', 'https://bad.test', 'new', `${shipmentId}?role=ADMIN`]) {
      assert.equal(notificationTarget({ type, data: { ...metadata, shipmentId: invalidId } }, 'CUSTOMER'), '/shipments');
    }
    assert.equal(notificationTarget({ type, data: null }, 'CUSTOMER'), '/shipments');
  }
});

test('Customer never uses operational IDs, arbitrary URLs or unsupported notification types', () => {
  for (const type of ['GENERAL', 'PICKUP_ASSIGNMENT_CREATED', 'DELIVERY_ASSIGNMENT_CREATED', 'PICKUP_ASSIGNMENT_REJECTED', 'COD_PAYOUT', 'PAYMENT_PAID']) {
    assert.equal(notificationTarget({ type, data: { shipmentId, assignmentId: shipmentId, url: '/admin/dashboard', role: 'ADMIN' } }, 'CUSTOMER'), '/shipments');
  }
});

test('Admin, Dispatcher, Warehouse and unauthenticated resolver behavior stays unchanged', () => {
  for (const role of ['ADMIN', 'DISPATCHER', 'WAREHOUSE_STAFF', undefined]) {
    for (const type of [...customerNotificationTypes.map(([type]) => type), 'PICKUP_ASSIGNMENT_REJECTED', 'PICKUP_ASSIGNMENT_CREATED', 'DELIVERY_ASSIGNMENT_CREATED']) {
      assert.equal(notificationTarget({ type, data: { shipmentId, assignmentId: shipmentId } }, role), undefined);
    }
  }
});
