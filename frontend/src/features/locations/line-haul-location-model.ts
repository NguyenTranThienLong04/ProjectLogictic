import type { MapMarker, MapPolyline } from './location-map';
import type { LineHaulLocationState, LineHaulTripLocation } from './location-types';

export const LINE_HAUL_LOCATION_TTL_MS = 20_000;

export function effectiveLineHaulLocationState(
  trip: LineHaulTripLocation,
  now = Date.now(),
): LineHaulLocationState {
  if (trip.status !== 'IN_TRANSIT') return 'DISABLED';
  if (trip.locationState !== 'CURRENT' || !trip.location) return trip.locationState;
  const capturedAt = Date.parse(trip.location.capturedAt);
  return Number.isFinite(capturedAt) &&
    now - capturedAt >= 0 &&
    now - capturedAt < LINE_HAUL_LOCATION_TTL_MS
    ? 'CURRENT'
    : 'STALE';
}

export function buildLineHaulTripMarkers(
  trip: LineHaulTripLocation,
  options: { includeEndpoints?: boolean; now?: number } = {},
): MapMarker[] {
  const markers: MapMarker[] = [];
  if (effectiveLineHaulLocationState(trip, options.now) === 'CURRENT' && trip.location) {
    markers.push({
      id: `linehaul-${trip.tripId}`,
      latitude: trip.location.latitude,
      longitude: trip.location.longitude,
      label: `${trip.tripCode} · ${trip.driver.fullName} · ${trip.vehicle.licensePlate}`,
      tone: 'driver',
    });
  }
  if (options.includeEndpoints !== false) {
    if (hasCoordinates(trip.origin)) {
      markers.push({
        id: `linehaul-origin-${trip.tripId}`,
        latitude: trip.origin.latitude,
        longitude: trip.origin.longitude,
        label: `Kho đi · ${trip.origin.code} · ${trip.origin.name}`,
        tone: 'origin',
      });
    }
    if (hasCoordinates(trip.destination)) {
      markers.push({
        id: `linehaul-destination-${trip.tripId}`,
        latitude: trip.destination.latitude,
        longitude: trip.destination.longitude,
        label: `Kho đến · ${trip.destination.code} · ${trip.destination.name}`,
        tone: 'destination',
      });
    }
  }
  return markers;
}

export function lineHaulFreshnessCopy(
  trip: LineHaulTripLocation,
  now = Date.now(),
): { label: string; tone: 'current' | 'warning' | 'muted' | 'danger' } {
  const state = effectiveLineHaulLocationState(trip, now);
  if (state === 'CURRENT' && trip.location) {
    const seconds = Math.max(0, Math.floor((now - Date.parse(trip.location.capturedAt)) / 1_000));
    return { label: `Hiện tại · ${seconds} giây trước`, tone: 'current' };
  }
  if (state === 'STALE') {
    return { label: 'Đã quá 20 giây · marker được ẩn', tone: 'warning' };
  }
  if (state === 'UNAVAILABLE') {
    return { label: 'Dịch vụ vị trí tạm gián đoạn', tone: 'danger' };
  }
  if (state === 'DISABLED') {
    return { label: 'GPS chỉ bật khi chuyến đang chạy', tone: 'muted' };
  }
  return { label: 'Chưa nhận được vị trí', tone: 'muted' };
}

export function buildLineHaulTripPolyline(trip: LineHaulTripLocation): MapPolyline[] {
  const points = trip.route?.geometry?.points ?? [];
  return points.length >= 2
    ? [
        {
          id: `linehaul-route-${trip.tripId}-${trip.route?.version ?? 0}`,
          points,
          label: `${trip.tripCode} · Tuyến hiện tại v${trip.route?.version ?? 1}`,
          tone: 'current',
        },
      ]
    : [];
}

function hasCoordinates(value: {
  latitude: number | null;
  longitude: number | null;
}): value is { latitude: number; longitude: number } {
  return (
    Number.isFinite(value.latitude) &&
    value.latitude !== null &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    Number.isFinite(value.longitude) &&
    value.longitude !== null &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}
