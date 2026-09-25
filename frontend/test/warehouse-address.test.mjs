import test from 'node:test';
import assert from 'node:assert/strict';
import { warehouseFormSchema, warehouseFormInput, warehouseFormValues, warehouseAddressContext } from '../src/features/warehouses/warehouse-form.ts';
import { getAddressFingerprint } from '../src/features/addresses/address-location-model.ts';

const warehouse = { code: 'WH-TEST', name: 'Test warehouse', address: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành', district: '', latitude: 10.769508, longitude: 106.690795 };
const values = { ...warehouse, confirmedAddressFingerprint: getAddressFingerprint(warehouseAddressContext(warehouse)) };
test('warehouse requires canonical hierarchy and explicit location confirmation', () => {
  assert.equal(warehouseFormInput(values).district, '');
  for (const change of [{ city: 'arbitrary' }, { ward: 'arbitrary' }, { confirmedAddressFingerprint: undefined }, { latitude: undefined }, { longitude: 181 }]) {
    assert.equal(warehouseFormSchema.safeParse({ ...values, ...change }).success, false);
  }
});
test('warehouse edit preserves legacy metadata; street/ward/province/district changes block stale writes', () => {
  const legacy = warehouseFormValues({ ...warehouse, city: 'Binh Duong', ward: 'Old ward', district: 'District 1' });
  assert.equal(warehouseFormInput({ ...legacy, name: 'New warehouse name' }).city, 'Binh Duong');
  for (const change of [{ address: '456 Street' }, { ward: 'Other ward' }, { city: 'Hà Nội' }, { district: '' }]) {
    assert.throws(() => warehouseFormInput({ ...legacy, ...change }));
  }
  assert.equal(warehouseFormInput({ ...warehouseFormValues(warehouse), name: 'Renamed warehouse' }).latitude, warehouse.latitude);
  assert.equal(warehouseFormSchema.safeParse(warehouseFormValues({ ...warehouse, latitude: null, longitude: null })).success, true);
});
