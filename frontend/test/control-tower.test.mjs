import assert from 'node:assert/strict';
import test from 'node:test';
import { agingLabel, itemPath, transferPath, tripPath, exceptionLabel } from '../src/features/control-tower/control-tower-model.ts';

test('Control Tower renders backend duration, including missing and long aging', () => {
  assert.equal(agingLabel(6 * 3600 + 42 * 60), '6h 42m');
  assert.equal(agingLabel(0), '0h 00m');
  assert.equal(agingLabel(null), 'Chưa xác định');
  assert.equal(agingLabel(49 * 3600), '49h 00m');
  assert.equal(exceptionLabel('TIMESTAMP_INCONSISTENT'), 'Mốc thời gian không nhất quán');
});
test('Control Tower links use the exact record and role route', () => {
  for (const role of ['admin', 'dispatcher']) {
    assert.equal(itemPath(role, { id: 'shipment-id', entityType: 'SHIPMENT' }), `/${role}/shipments/shipment-id`);
    assert.equal(itemPath(role, { id: 'trip-id', entityType: 'TRIP' }), tripPath(role, 'trip-id'));
    assert.equal(transferPath(role, 'origin-id', 'transfer-id'), `/${role}/warehouses/origin-id/transfers/transfer-id`);
  }
  assert.equal(tripPath('admin', 'trip-id'), '/admin/line-haul/trips/trip-id');
  assert.equal(tripPath('dispatcher', 'trip-id'), '/dispatcher/line-haul/trip-id');
});
