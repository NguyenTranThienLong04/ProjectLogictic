import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAddressViewport } from '../src/features/locations/location-viewport.ts';

test('city aliases plus a current ward focus Ben Thanh without geocoding the street', () => {
  for (const city of ['Ho Chi Minh City', 'TP. Hồ Chí Minh', 'Thành phố Hồ Chí Minh', 'TP.HCM', '  HỒ CHÍ MINH  ', 'Saigon']) {
    assert.deepEqual(resolveAddressViewport({ street: '123 Nguyễn Trãi', ward: 'Bến Thành', district: 'Quận 1', city }), {
      center: { latitude: 10.77, longitude: 106.695 }, zoom: 15,
    });
  }
});

test('Hanoi aliases focus Hanoi', () => {
  for (const city of ['Hà Nội', 'Ha Noi', 'Hanoi', 'TP. Hà Nội', 'Hanoi City']) {
    assert.deepEqual(resolveAddressViewport({ city }), {
      center: { latitude: 21, longitude: 105.698 }, zoom: 12,
    });
  }
});

test('missing or unrecognized city uses Vietnam, never world view', () => {
  for (const address of [undefined, {}, { city: 'Unknown' }, { city: '  ' }, { street: '123 Nguyễn Trãi' }]) {
    assert.deepEqual(resolveAddressViewport(address), { center: { latitude: 16, longitude: 106 }, zoom: 6 });
  }
});
