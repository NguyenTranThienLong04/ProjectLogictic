import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationTarget } from '../src/features/notifications/notification-target.ts';
import { packageDimensionSchemas, dimensionInputError } from '../src/features/shipments/package-dimensions.ts';
import { transferBlockReason } from '../src/features/warehouses/transfer-form.ts';

const assignmentId = '10000000-0000-4000-8000-000000000021';
test('notification routes use assignment ID, task type and Driver role', () => {
  for (const [type, route] of [['PICKUP_ASSIGNMENT_CREATED', '/driver/pickups/'], ['DELIVERY_ASSIGNMENT_CREATED', '/driver/deliveries/']]) {
    assert.equal(notificationTarget({ type, data: { shipmentId: 'shipment', assignmentId } }, 'DRIVER'), route + assignmentId);
    assert.equal(notificationTarget({ type, data: { assignmentId } }, 'CUSTOMER'), undefined);
  }
});
test('missing or malformed entity falls back without using shipment IDs or arbitrary URLs', () => {
  for (const assignmentId of [undefined, '', 123, '../bad', 'https://bad.test', 'malformed']) {
    assert.equal(notificationTarget({ type: 'PICKUP_ASSIGNMENT_CREATED', data: { assignmentId, shipmentId: 'shipment' } }, 'DRIVER'), '/driver/assignments');
    assert.equal(notificationTarget({ type: 'DELIVERY_ASSIGNMENT_CREATED', data: { assignmentId } }, 'DRIVER'), '/driver/deliveries');
  }
  assert.equal(notificationTarget({ type: 'GENERAL', data: null }, 'DRIVER'), '/driver/assignments');
});
test('create/quote/check-in dimension validation allows tenths and rejects invalid precision or bounds', () => {
  for (const field of ['lengthCm', 'widthCm', 'heightCm']) {
    for (const value of [1, 14.8, 20, 300]) {
      assert.equal(packageDimensionSchemas[field].safeParse(value).success, true);
      assert.equal(dimensionInputError(field, String(value)), undefined);
    }
    for (const value of ['', '0', '-1', '301', '14.81', 'NaN', 'Infinity']) {
      assert.equal(typeof dimensionInputError(field, value), 'string');
    }
  }
});
test('transfer blocks missing/mismatched/inactive/same destination, wrong state/location and existing transfer', () => {
  const shipment = { id: 'shipment', status: 'AT_ORIGIN_WAREHOUSE', currentWarehouseId: 'origin', destinationWarehouseId: 'destination',
    destinationWarehouse: { id: 'destination', isActive: true } };
  const context = { shipment, activeTransfer: undefined };
  assert.equal(transferBlockReason(context, 'origin'), undefined);
  for (const overrides of [
    { destinationWarehouseId: null }, { destinationWarehouse: null },
    { destinationWarehouse: { id: 'wrong' } }, { destinationWarehouse: { id: 'destination', isActive: false } },
    { destinationWarehouseId: 'origin' }, { currentWarehouseId: 'elsewhere' }, { status: 'DELIVERED' },
  ]) assert.equal(typeof transferBlockReason({ ...context, shipment: { ...shipment, ...overrides } }, 'origin'), 'string');
  assert.match(transferBlockReason({ ...context, activeTransfer: { transferCode: 'TRF-EXISTS' } }, 'origin'), /TRF-EXISTS/);
  assert.equal(typeof transferBlockReason({ ...context, shipment: null }, 'origin'), 'string');
});
