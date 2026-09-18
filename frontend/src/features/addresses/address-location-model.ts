import { hasValidCoordinates } from '../locations/driver-task-map-model.ts';

export type LocationAddressContext = {
  street?: string;
  ward?: string;
  district?: string;
  city?: string;
};

export type Coordinate = { latitude: number; longitude: number };
export const STALE_LOCATION_MESSAGE = 'Địa chỉ đã thay đổi. Vui lòng chọn lại vị trí trên bản đồ.';

export function normalizeAddressText(value = ''): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('vi').replace(/\s+/gu, ' ');
}

export function getAddressFingerprint(address: LocationAddressContext): string {
  return JSON.stringify([address.street, address.ward, address.district, address.city].map((part) => normalizeAddressText(part)));
}

export function savedAddressContext(address: { streetAddress?: string; ward?: string; district?: string; city?: string }): LocationAddressContext {
  return { street: address.streetAddress, ward: address.ward, district: address.district, city: address.city };
}

export function isLocationStale(fingerprint: string | undefined, address: LocationAddressContext): boolean {
  return fingerprint !== undefined && fingerprint !== getAddressFingerprint(address);
}

export function getConfirmedCoordinate(
  coordinate: Coordinate | undefined,
  fingerprint: string | undefined,
  address: LocationAddressContext,
): Coordinate | undefined {
  return fingerprint === getAddressFingerprint(address) && hasValidCoordinates(coordinate) ? coordinate : undefined;
}
