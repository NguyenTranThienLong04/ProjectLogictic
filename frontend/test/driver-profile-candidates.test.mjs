import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverAccountLabel,
  filterDriverAccounts,
  getEligibleDriverAccounts,
} from '../src/features/operations/driver-profile-candidates.ts';

const baseUser = {
  phone: null,
  mustChangePassword: false,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
};

test('offers only active DRIVER accounts without a DriverProfile', () => {
  const users = [
    { ...baseUser, id: 'driver-test', email: 'driver@test.com', fullName: 'Driver Test', role: 'DRIVER', status: 'ACTIVE' },
    { ...baseUser, id: 'linked-driver', email: 'linked@test.com', fullName: 'Linked Driver', role: 'DRIVER', status: 'ACTIVE' },
    { ...baseUser, id: 'suspended-driver', email: 'suspended@test.com', fullName: 'Suspended Driver', role: 'DRIVER', status: 'SUSPENDED' },
    { ...baseUser, id: 'customer', email: 'customer@test.com', fullName: 'Customer', role: 'CUSTOMER', status: 'ACTIVE' },
  ];

  const eligible = getEligibleDriverAccounts(users, [{ userId: 'linked-driver' }]);

  assert.deepEqual(eligible.map((user) => user.email), ['driver@test.com']);
  assert.equal(driverAccountLabel(eligible[0]), 'Driver Test — driver@test.com');
  assert.equal(filterDriverAccounts(eligible, 'DRIVER@TEST').length, 1);
  assert.equal(filterDriverAccounts(eligible, 'không tồn tại').length, 0);
});
