import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getAddressFingerprint, getConfirmedCoordinate, savedAddressContext } from '../src/features/addresses/address-location-model.ts';
import { provinces, wards, findProvince, findWard, normalizeAdministrativeSearch } from '../src/features/addresses/administrative-model.ts';
import { addressSchema, addressFormInput, emptyAddressForm } from '../src/features/addresses/address-form.ts';
import { deliverySnapshot, getDeliveryAddressContext, shipmentFormDefaults, shipmentFormSchema } from '../src/features/shipments/shipment-form.ts';
import { resolveAddressViewport } from '../src/features/locations/location-viewport.ts';

const address = { street: '123 Nguyễn Trãi', ward: 'Bến Thành', district: '', city: 'Hồ Chí Minh' };
const coordinate = { latitude: 13.114442, longitude: 26.442573 };
const fingerprint = getAddressFingerprint(address);
const saved = { ...emptyAddressForm, label: 'Nhà', contactName: 'Nguyễn An', phone: '0901234567',
  streetAddress: address.street, ward: address.ward, city: address.city, ...coordinate,
  confirmedAddressFingerprint: fingerprint, originalAddressFingerprint: fingerprint };
const delivery = { ...shipmentFormDefaults, pickupAddressId: '210e5c56-6639-46a3-98dd-dd6e3da0498d',
  deliveryContactName: 'Nguyễn An', deliveryPhone: '0901234567', deliveryStreetAddress: address.street,
  deliveryCity: address.city, deliveryWard: address.ward, deliveryLatitude: coordinate.latitude,
  deliveryLongitude: coordinate.longitude, confirmedAddressFingerprint: fingerprint, description: 'Kiện hàng', shippingFeePayer: 'SENDER' };

test('pinned dataset integrity: 34 provinces, 3321 unique wards, valid parents/coordinates and checksum', () => {
  assert.equal(provinces.length, 34);
  assert.equal(wards.length, 3321);
  assert.equal(new Set(wards.map((w) => w.code)).size, 3321);
  assert.equal(new Set(provinces.map((p) => p.code)).size, 34);
  for (const unit of [...provinces, ...wards]) {
    assert(Number.isFinite(unit.latitude) && Math.abs(unit.latitude) <= 90);
    assert(Number.isFinite(unit.longitude) && Math.abs(unit.longitude) <= 180);
  }
  for (const ward of wards) assert(provinces.some((p) => p.code === ward.provinceCode));
  const bytes = readFileSync(new URL('../src/features/addresses/data/vietnam-admin.json', import.meta.url));
  const source = JSON.parse(readFileSync(new URL('../src/features/addresses/data/SOURCE.json', import.meta.url)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.outputSha256);
});

test('accent-insensitive search and province-scoped ward lookup', () => {
  assert.equal(normalizeAdministrativeSearch('Hồ Chí Minh'), 'ho chi minh');
  assert.equal(normalizeAdministrativeSearch(' BẾN   THÀNH '), 'ben thanh');
  assert.equal(normalizeAdministrativeSearch('Đà Nẵng'), 'da nang');
  assert.equal(findProvince('Ho Chi Minh City').code, '79');
  assert.equal(findWard('79', 'phường bến thành').code, '26743');
  assert.equal(findWard('01', 'Bến Thành'), undefined);
  assert.equal(findProvince('Bình Dương'), undefined);
});

test('ward focus takes priority, province fallback is shared, neither is a selection', () => {
  assert.deepEqual(resolveAddressViewport(address), { center: { latitude: 10.77, longitude: 106.695 }, zoom: 15 });
  assert.equal(resolveAddressViewport({ city: address.city }).zoom, 12);
  assert.equal(resolveAddressViewport({ city: 'unknown' }).zoom, 6);
  assert.equal(getConfirmedCoordinate(undefined, fingerprint, address), undefined);
});

test('fingerprint normalizes Unicode, case, surrounding/repeated whitespace, preserving accents', () => {
  assert.equal(getAddressFingerprint({ ...address, street: ' 123  NGUYỄN TRÃI '.normalize('NFD') }), fingerprint);
  assert.notEqual(getAddressFingerprint({ ...address, street: '123 Nguyen Trai' }), fingerprint);
});

for (const field of ['street', 'ward', 'district', 'city']) {
  test(`${field} change invalidates confirmed coordinate`, () => {
    assert.equal(getConfirmedCoordinate(coordinate, fingerprint, { ...address, [field]: `${address[field]} khác` }), undefined);
  });
}

test('Saved Address create/edit require matching confirmation; metadata changes preserve coordinate', () => {
  const result = addressFormInput(saved);
  assert.equal(result.latitude, coordinate.latitude);
  assert(!('confirmedAddressFingerprint' in result));
  for (const change of [{ phone: '0987654321' }, { contactName: 'Tên khác' }, { label: 'Công ty' }, { isDefault: true }]) {
    assert.equal(addressFormInput({ ...saved, ...change }).longitude, coordinate.longitude);
  }
  const changed = { ...saved, streetAddress: '124 Nguyễn Trãi' };
  assert.equal(addressSchema.safeParse(changed).success, false);
  assert.throws(() => addressFormInput(changed));
  assert.equal(addressFormInput({ ...changed, confirmedAddressFingerprint: getAddressFingerprint(savedAddressContext(changed)) }).latitude, coordinate.latitude);
});

test('legacy geographic fields are preserved for contact-only edit but cannot create arbitrary addresses', () => {
  const legacy = { ...saved, city: 'Tỉnh cũ', ward: 'Phường cũ', district: 'Quận 1' };
  const fp = getAddressFingerprint(savedAddressContext(legacy));
  assert.equal(addressFormInput({ ...legacy, confirmedAddressFingerprint: fp, originalAddressFingerprint: fp }).district, 'Quận 1');
  assert.equal(addressSchema.safeParse({ ...legacy, originalAddressFingerprint: undefined }).success, false);
});

test('delivery serializer never sends Africa coordinate after changing the current address', () => {
  assert.equal(deliverySnapshot(delivery).latitude, coordinate.latitude);
  for (const change of [{ deliveryStreetAddress: '124 Nguyễn Trãi' }, { deliveryWard: 'Sài Gòn' }, { deliveryCity: 'Hà Nội' }, { deliveryDistrict: 'Quận khác' }]) {
    const snapshot = deliverySnapshot({ ...delivery, ...change });
    assert(!('latitude' in snapshot));
    assert(!('longitude' in snapshot));
  }
  assert.equal(deliverySnapshot({ ...delivery, deliveryPhone: '0987654321' }).latitude, coordinate.latitude);
  const changed = { ...delivery, deliveryStreetAddress: '124 Nguyễn Trãi', deliveryLatitude: 10.77, deliveryLongitude: 106.695 };
  assert.equal(deliverySnapshot({ ...changed, confirmedAddressFingerprint: getAddressFingerprint(getDeliveryAddressContext(changed)) }).latitude, 10.77);
  assert(!('latitude' in deliverySnapshot({ ...delivery, confirmedAddressFingerprint: undefined })));
});

test('delivery schema accepts two-level addresses, rejects a ward under the wrong province', () => {
  assert(shipmentFormSchema.safeParse(delivery).success);
  assert(!shipmentFormSchema.safeParse({ ...delivery, deliveryCity: 'Hà Nội' }).success);
});
