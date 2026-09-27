import assert from 'node:assert/strict';
import test from 'node:test';
import { locateBrowserPosition, browserLocationErrorMessage } from '../src/features/locations/browser-location.ts';
import { isFarFromSelectedArea } from '../src/features/locations/location-viewport.ts';

function mockGeolocation(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation');
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis.navigator, 'geolocation', descriptor);
    else delete globalThis.navigator.geolocation;
  });
}

test('shared acquisition requests fresh high-accuracy device GPS without publishing', async (t) => {
  const sample = { coords: { latitude: 10.12345678, longitude: 106.12345678 }, timestamp: Date.now() };
  mockGeolocation(t, { getCurrentPosition(success, _error, options) {
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    success(sample);
  } });
  assert.deepEqual(await locateBrowserPosition(), { ...sample.coords, timestamp: sample.timestamp });
});

for (const [code, message] of [[1, 'bật quyền vị trí'], [2, 'Không lấy được vị trí'], [3, 'quá thời gian chờ']]) {
  test(`device error ${code} preserves error and offers fallback`, async (t) => {
    const failure = { code };
    mockGeolocation(t, { getCurrentPosition(_success, fail) { fail(failure); } });
    await assert.rejects(locateBrowserPosition(), (error) => error === failure);
    assert(browserLocationErrorMessage(failure).includes(message));
    assert(browserLocationErrorMessage(failure).includes('pin thủ công'));
  });
}

test('area warning is advisory, uses canonical points, ignores unknown locality', () => {
  const address = { city: 'Hồ Chí Minh', ward: 'Bến Thành' };
  assert.equal(isFarFromSelectedArea({ latitude: 10.77, longitude: 106.695 }, address), false);
  assert.equal(isFarFromSelectedArea({ latitude: 21.0285, longitude: 105.8542 }, address), true);
  assert.equal(isFarFromSelectedArea({ latitude: 21.0285, longitude: 105.8542 }, { city: 'Hồ Chí Minh' }), true);
  assert.equal(isFarFromSelectedArea({ latitude: 21, longitude: 105 }, {}), false);
  assert.deepEqual(address, { city: 'Hồ Chí Minh', ward: 'Bến Thành' });
});
