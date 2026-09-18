export type LocationAddressContext = {
  street?: string;
  ward?: string;
  district?: string;
  city?: string;
};

export type LocationViewport = {
  center: { latitude: number; longitude: number };
  zoom: number;
};

export const DEFAULT_VIETNAM_CENTER = { latitude: 16, longitude: 106 };
export const DEFAULT_VIETNAM_ZOOM = 6;
export const DEFAULT_CITY_ZOOM = 12;
export const DEFAULT_SELECTED_LOCATION_ZOOM = 16;

// Approximate city focus only; these points are never selected or persisted.
const CITY_CENTERS = {
  hochiminh: { latitude: 10.7769, longitude: 106.7009 },
  hanoi: { latitude: 21.0285, longitude: 105.8542 },
};

export function resolveAddressViewport(address?: LocationAddressContext): LocationViewport {
  const city = (address?.city ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(thanhpho|tp)/, '')
    .replace(/city$/, '');
  const center = city === 'hochiminh' || city === 'hcm' || city === 'saigon'
    ? CITY_CENTERS.hochiminh
    : city === 'hanoi' ? CITY_CENTERS.hanoi : undefined;
  return center
    ? { center, zoom: DEFAULT_CITY_ZOOM }
    : { center: DEFAULT_VIETNAM_CENTER, zoom: DEFAULT_VIETNAM_ZOOM };
}
