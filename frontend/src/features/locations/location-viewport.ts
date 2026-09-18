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
