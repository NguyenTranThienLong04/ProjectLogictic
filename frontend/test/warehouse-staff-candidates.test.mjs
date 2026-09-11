import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterWarehouseStaffAccounts,
  getEligibleWarehouseStaffAccounts,
  warehouseStaffAccountLabel,
} from '../src/features/warehouses/warehouse-staff-candidates.ts';

const baseUser = {
  phone: null,
  mustChangePassword: false,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

test('offers only active unassigned WAREHOUSE_STAFF accounts', () => {
  const users = [
    { ...baseUser, id: 'warehouse-test', email: 'warehouse@test.com', fullName: 'Warehouse Test', role: 'WAREHOUSE_STAFF', status: 'ACTIVE' },
    { ...baseUser, id: 'assigned-staff', email: 'assigned@test.com', fullName: 'Assigned Staff', role: 'WAREHOUSE_STAFF', status: 'ACTIVE' },
    { ...baseUser, id: 'suspended-staff', email: 'suspended@test.com', fullName: 'Suspended Staff', role: 'WAREHOUSE_STAFF', status: 'SUSPENDED' },
    { ...baseUser, id: 'driver', email: 'driver@test.com', fullName: 'Driver', role: 'DRIVER', status: 'ACTIVE' },
  ];

  const eligible = getEligibleWarehouseStaffAccounts(users, [{ userId: 'assigned-staff' }]);

  assert.deepEqual(eligible.map((user) => user.email), ['warehouse@test.com']);
  assert.equal(warehouseStaffAccountLabel(eligible[0]), 'Warehouse Test — warehouse@test.com');
  assert.equal(filterWarehouseStaffAccounts(eligible, 'WAREHOUSE@TEST').length, 1);
  assert.equal(filterWarehouseStaffAccounts(eligible, 'không tồn tại').length, 0);
});
