import { findProvince, findWard } from '../addresses/administrative-model.ts';
import { hasValidCoordinates } from './driver-task-map-model.ts';
import type { LocationAddressContext } from '../addresses/address-location-model';
export type { LocationAddressContext } from '../addresses/address-location-model';

export type LocationViewport = {
  center: { latitude: number; longitude: number };
  zoom: number;
};

export const DEFAULT_VIETNAM_CENTER = { latitude: 16, longitude: 106 };
export const DEFAULT_VIETNAM_ZOOM = 6;
export const DEFAULT_CITY_ZOOM = 12;
export const DEFAULT_WARD_ZOOM = 15;
export const DEFAULT_SELECTED_LOCATION_ZOOM = 16;

export function resolveAddressViewport(address?: LocationAddressContext): LocationViewport {
  const province = findProvince(address?.city);
  const ward = findWard(province?.code, address?.ward);
  if (hasValidCoordinates(ward)) return { center: { latitude: ward.latitude, longitude: ward.longitude }, zoom: DEFAULT_WARD_ZOOM };
  if (hasValidCoordinates(province)) return { center: { latitude: province.latitude, longitude: province.longitude }, zoom: DEFAULT_CITY_ZOOM };
  return { center: DEFAULT_VIETNAM_CENTER, zoom: DEFAULT_VIETNAM_ZOOM };
}

// Advisory distance from dataset points, not an administrative boundary test.
// Generous limits avoid claiming precise containment without ward/province polygons.
export function isFarFromSelectedArea(point: { latitude: number; longitude: number }, address: LocationAddressContext): boolean {
  const province = findProvince(address.city);
  const ward = findWard(province?.code, address.ward);
  const anchor = hasValidCoordinates(ward) ? ward : province;
  if (!hasValidCoordinates(anchor)) return false;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(radians(point.latitude - anchor.latitude) / 2) ** 2
    + Math.cos(radians(point.latitude)) * Math.cos(radians(anchor.latitude))
    * Math.sin(radians(point.longitude - anchor.longitude) / 2) ** 2;
  const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  return distanceKm > (hasValidCoordinates(ward) ? 20 : 200);
}
