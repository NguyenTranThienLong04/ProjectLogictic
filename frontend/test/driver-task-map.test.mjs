import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddressFingerprint } from '../src/features/addresses/address-location-model.ts';
import {
  DRIVER_LOCATION_TTL_MS,
  buildGoogleMapsDirectionsUrl,
  buildTaskMapMarkers,
  hasValidCoordinates,
  resolveDriverLocationState,
} from '../src/features/locations/driver-task-map-model.ts';
import {
  deliverySnapshot,
  parseOptionalCoordinateInput,
  shipmentFormDefaults,
  shipmentFormSchema,
} from '../src/features/shipments/shipment-form.ts';

const now = Date.parse('2026-09-02T08:00:20.000Z');
const freshDriver = {
  driverId: 'driver-1',
  latitude: 10.7769,
  longitude: 106.7009,
  updatedAt: new Date(now - DRIVER_LOCATION_TTL_MS + 1).toISOString(),
};

function target(kind, overrides = {}) {
  return {
    kind,
    label: `Target ${kind}`,
    address: '1 Nguyễn Huệ, Hồ Chí Minh',
    latitude: 10.78,
    longitude: 106.71,
    ...overrides,
  };
}

test('pickup, warehouse, and receiver tasks render current driver plus the authorized target', () => {
  const driverState = resolveDriverLocationState(freshDriver, null, now);

  for (const kind of ['PICKUP', 'DESTINATION_WAREHOUSE', 'RECEIVER']) {
    const markers = buildTaskMapMarkers(target(kind), driverState);
    assert.deepEqual(
      markers.map((marker) => [marker.id, marker.tone]),
      [
        ['driver-current-location', 'driver'],
        [`task-${kind.toLowerCase()}`, 'destination'],
      ],
    );
  }
});

test('missing GPS keeps the target visible without inventing a driver marker', () => {
  const state = resolveDriverLocationState(null, null, now);
  const markers = buildTaskMapMarkers(target('PICKUP'), state);

  assert.equal(state.status, 'missing');
  assert.deepEqual(
    markers.map((marker) => marker.id),
    ['task-pickup'],
  );
});

test('the 20 second boundary is stale and removes the driver marker', () => {
  const atBoundary = {
    ...freshDriver,
    updatedAt: new Date(now - DRIVER_LOCATION_TTL_MS).toISOString(),
  };
  const stale = resolveDriverLocationState(atBoundary, null, now);
  const retainedStale = resolveDriverLocationState(null, atBoundary, now);

  assert.equal(stale.status, 'stale');
  assert.equal(retainedStale.status, 'stale');
  assert.deepEqual(
    buildTaskMapMarkers(target('RECEIVER'), stale).map((marker) => marker.id),
    ['task-receiver'],
  );
});

test('coordinate validation accepts zero and rejects partial or out-of-range pairs', () => {
  assert.equal(hasValidCoordinates({ latitude: 0, longitude: 0 }), true);
  assert.equal(hasValidCoordinates({ latitude: 10, longitude: null }), false);
  assert.equal(hasValidCoordinates({ latitude: 91, longitude: 106 }), false);
  assert.equal(hasValidCoordinates({ latitude: Number.NaN, longitude: 106 }), false);
});

test('Google Maps deep-link uses destination only and delegates navigation to the provider', () => {
  const coordinatesUrl = new URL(buildGoogleMapsDirectionsUrl(target('PICKUP')));

  assert.equal(coordinatesUrl.origin, 'https://www.google.com');
  assert.equal(coordinatesUrl.pathname, '/maps/dir/');
  assert.equal(coordinatesUrl.searchParams.get('api'), '1');
  assert.equal(coordinatesUrl.searchParams.get('destination'), '10.78,106.71');
  assert.equal(coordinatesUrl.searchParams.get('travelmode'), 'driving');
  assert.equal(coordinatesUrl.searchParams.get('dir_action'), 'navigate');
  assert.equal(coordinatesUrl.searchParams.has('origin'), false);

  const addressUrl = new URL(
    buildGoogleMapsDirectionsUrl(target('RECEIVER', { latitude: null, longitude: null })),
  );
  assert.equal(addressUrl.searchParams.get('destination'), '1 Nguyễn Huệ, Hồ Chí Minh');
  assert.equal(
    buildGoogleMapsDirectionsUrl(
      target('RECEIVER', { address: ' ', latitude: null, longitude: null }),
    ),
    null,
  );
});

test('receiver coordinate inputs preserve a complete optional pair in the immutable snapshot', () => {
  const values = {
    ...shipmentFormDefaults,
    deliveryContactName: 'Receiver',
    deliveryPhone: '0901234567',
    deliveryStreetAddress: '1 Nguyễn Huệ',
    deliveryWard: 'Bến Thành',
    deliveryDistrict: 'Quận 1',
    deliveryCity: 'Hồ Chí Minh',
    deliveryLatitude: 10.7769,
    deliveryLongitude: 106.7009,
    confirmedAddressFingerprint: getAddressFingerprint({ street: '1 Nguyễn Huệ', ward: 'Bến Thành', district: 'Quận 1', city: 'Hồ Chí Minh' }),
  };

  assert.deepEqual(deliverySnapshot(values), {
    contactName: 'Receiver',
    phone: '0901234567',
    streetAddress: '1 Nguyễn Huệ',
    ward: 'Bến Thành',
    district: 'Quận 1',
    city: 'Hồ Chí Minh',
    latitude: 10.7769,
    longitude: 106.7009,
  });
  assert.equal(parseOptionalCoordinateInput(''), undefined);
  assert.equal(parseOptionalCoordinateInput('0'), 0);
  assert.equal(
    shipmentFormSchema.safeParse({ ...values, deliveryLongitude: undefined }).success,
    false,
  );
});
