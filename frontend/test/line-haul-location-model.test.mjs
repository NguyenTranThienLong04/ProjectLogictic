import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LINE_HAUL_LOCATION_TTL_MS,
  buildLineHaulTripMarkers,
  buildLineHaulTripPolyline,
  effectiveLineHaulLocationState,
  lineHaulFreshnessCopy,
} from '../src/features/locations/line-haul-location-model.ts';

const now = Date.parse('2026-09-05T08:00:20.000Z');

function trip(overrides = {}) {
  return {
    tripId: 'trip-1',
    tripCode: 'LHT-20260905-ABC123',
    status: 'IN_TRANSIT',
    departedAt: '2026-09-05T07:00:00.000Z',
    locationState: 'CURRENT',
    location: {
      tripId: 'trip-1',
      latitude: 10.7769,
      longitude: 106.7009,
      capturedAt: new Date(now - 5_000).toISOString(),
    },
    lastCapturedAt: new Date(now - 5_000).toISOString(),
    route: {
      version: 1,
      type: 'PLANNED',
      distanceMeters: 1_000,
      durationSeconds: 120,
      geometry: {
        points: [
          { latitude: 10.77, longitude: 106.7 },
          { latitude: 16.06, longitude: 108.22 },
        ],
      },
      calculatedAt: '2026-09-05T07:00:00.000Z',
    },
    remainingRoute: null,
    deviation: { state: 'ON_ROUTE', distanceFromRouteMeters: 5, detectedAt: null },
    driver: { id: 'driver-1', fullName: 'Nguyễn Văn An', employeeCode: 'DRV-001' },
    vehicle: {
      id: 'vehicle-1',
      vehicleCode: 'LH-01',
      licensePlate: '51C-12345',
      vehicleType: 'TRUCK',
    },
    origin: {
      id: 'warehouse-1',
      code: 'SGN',
      name: 'Kho Sài Gòn',
      address: '1 Nguyễn Huệ',
      latitude: 10.77,
      longitude: 106.7,
    },
    destination: {
      id: 'warehouse-2',
      code: 'DAD',
      name: 'Kho Đà Nẵng',
      address: '2 Bạch Đằng',
      latitude: 16.06,
      longitude: 108.22,
    },
    ...overrides,
  };
}

test('current line-haul GPS renders vehicle, origin, and destination markers', () => {
  const markers = buildLineHaulTripMarkers(trip(), { now });
  assert.deepEqual(
    markers.map((marker) => marker.tone),
    ['driver', 'origin', 'destination'],
  );
  assert.match(markers[0].label, /LHT-20260905-ABC123.*51C-12345/);
});

test('renders only normalized road geometry and never invents a straight-line route', () => {
  const [polyline] = buildLineHaulTripPolyline(trip());
  assert.equal(polyline.tone, 'current');
  assert.equal(polyline.points.length, 2);
  assert.match(polyline.label, /v1/);

  assert.deepEqual(buildLineHaulTripPolyline(trip({ route: null })), []);
  assert.deepEqual(
    buildLineHaulTripPolyline(trip({ route: { ...trip().route, geometry: null } })),
    [],
  );
});

test('the 20-second boundary is stale and never renders as a current vehicle marker', () => {
  const staleTrip = trip({
    location: {
      ...trip().location,
      capturedAt: new Date(now - LINE_HAUL_LOCATION_TTL_MS).toISOString(),
    },
  });

  assert.equal(effectiveLineHaulLocationState(staleTrip, now), 'STALE');
  assert.deepEqual(
    buildLineHaulTripMarkers(staleTrip, { now }).map((marker) => marker.tone),
    ['origin', 'destination'],
  );
  assert.match(lineHaulFreshnessCopy(staleTrip, now).label, /marker được ẩn/);
});

test('inactive lifecycle and service outage remain explicit non-current UI states', () => {
  const ready = trip({ status: 'READY', locationState: 'DISABLED', location: null });
  const unavailable = trip({ locationState: 'UNAVAILABLE', location: null });

  assert.equal(effectiveLineHaulLocationState(ready, now), 'DISABLED');
  assert.equal(lineHaulFreshnessCopy(ready, now).tone, 'muted');
  assert.equal(effectiveLineHaulLocationState(unavailable, now), 'UNAVAILABLE');
  assert.equal(lineHaulFreshnessCopy(unavailable, now).tone, 'danger');
  assert.deepEqual(buildLineHaulTripMarkers(unavailable, { includeEndpoints: false, now }), []);
});
