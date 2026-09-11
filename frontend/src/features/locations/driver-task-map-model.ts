import type { DriverLocation, DriverTaskLocation } from './location-types';

export const DRIVER_LOCATION_TTL_MS = 20_000;

export type DriverLocationState =
  | { status: 'current'; location: DriverLocation }
  | { status: 'stale'; location: DriverLocation }
  | { status: 'missing'; location: null };

export interface TaskMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  tone: 'driver' | 'destination';
}

export function resolveDriverLocationState(
  current: DriverLocation | null | undefined,
  lastKnown: DriverLocation | null,
  now = Date.now(),
): DriverLocationState {
  if (hasValidCoordinates(current)) {
    return isCurrentLocation(current, now)
      ? { status: 'current', location: current }
      : { status: 'stale', location: current };
  }
  if (hasValidCoordinates(lastKnown) && !isCurrentLocation(lastKnown, now)) {
    return { status: 'stale', location: lastKnown };
  }
  return { status: 'missing', location: null };
}

export function buildTaskMapMarkers(
  target: DriverTaskLocation | null,
  driverState: DriverLocationState,
): TaskMapMarker[] {
  const markers: TaskMapMarker[] = [];
  if (driverState.status === 'current') {
    markers.push({
      id: 'driver-current-location',
      latitude: driverState.location.latitude,
      longitude: driverState.location.longitude,
      label: 'Vị trí GPS hiện tại của bạn',
      tone: 'driver',
    });
  }
  if (hasValidCoordinates(target)) {
    markers.push({
      id: `task-${target.kind.toLowerCase()}`,
      latitude: target.latitude,
      longitude: target.longitude,
      label: target.label,
      tone: 'destination',
    });
  }
  return markers;
}

export function buildGoogleMapsDirectionsUrl(target: DriverTaskLocation | null): string | null {
  if (!target) return null;
  const destination = hasValidCoordinates(target)
    ? `${target.latitude},${target.longitude}`
    : target.address.trim();
  if (!destination) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  url.searchParams.set('travelmode', 'driving');
  url.searchParams.set('dir_action', 'navigate');
  return url.toString();
}

export function hasValidCoordinates(
  value: { latitude?: number | null; longitude?: number | null } | null | undefined,
): value is { latitude: number; longitude: number } {
  return Boolean(
    value &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    (value.latitude as number) >= -90 &&
    (value.latitude as number) <= 90 &&
    (value.longitude as number) >= -180 &&
    (value.longitude as number) <= 180,
  );
}

function isCurrentLocation(location: DriverLocation, now: number): boolean {
  const updatedAt = Date.parse(location.updatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt < DRIVER_LOCATION_TTL_MS;
}
