import {
  findProvince,
  findWard,
  normalizeAdministrativeSearch,
  type Province,
  type Ward,
} from '../../common/addresses/administrative-data.js';

import type { LocationIqAddress } from './locationiq-address-normalization.js';

export type SelectedAdministration = { province: Province; ward: Ward };

const isWardLabel = (name: string): boolean =>
  /^(phuong|xa|dac khu)\s+|\s+(ward|commune)$/.test(normalizeAdministrativeSearch(name));
const isDistrictLabel = (name: string): boolean =>
  /^(quan|huyen|district)\s+|\s+district$/.test(normalizeAdministrativeSearch(name));

// This snapshot contains approximate centres, not administrative boundaries.
// Reuse this same search window for retrieval AND containment checks. It is not
// a ward polygon, so explicit conflicting administrative metadata still vetoes it.
export function addressSearchViewbox({ ward }: SelectedAdministration): string {
  const latitudeDelta = 0.05;
  const longitudeDelta = latitudeDelta / Math.cos((ward.latitude * Math.PI) / 180);
  return [
    ward.longitude - longitudeDelta,
    ward.latitude - latitudeDelta,
    ward.longitude + longitudeDelta,
    ward.latitude + latitudeDelta,
  ]
    .map((coordinate) => coordinate.toFixed(6))
    .join(',');
}

export function isInAddressSearchArea(
  latitude: number,
  longitude: number,
  selected: SelectedAdministration,
): boolean {
  const [west, south, east, north] = addressSearchViewbox(selected).split(',').map(Number);
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

export function matchesSearchStreet(address: LocationIqAddress, street: string): boolean {
  const normalizeRoad = (name: string) =>
    normalizeAdministrativeSearch(name)
      .replace(/^(duong|street)\s+/, '')
      .replace(/\s+street$/, '');
  const requested = normalizeAdministrativeSearch(street);
  const house = requested.match(/^(\d+[a-z]?(?:[/-]\d+[a-z]?)*)(?:\s*,\s*|\s+)(.+)$/);
  const road = address.road;
  if (!road || normalizeRoad(road) !== normalizeRoad(house ? house[2] : requested)) return false;
  return !house || normalizeAdministrativeSearch(address.houseNumber ?? '') === house[1];
}

// Run together with coordinate containment and structured street/house matching.
// Warnings are audit diagnostics, never canonical metadata or UI labels.
export function assessAdministration(
  address: LocationIqAddress,
  { province, ward }: SelectedAdministration,
): { rejection?: string; warnings: string[] } {
  const warnings: string[] = [];
  const reject = (rejection: string) => ({ rejection, warnings });
  if (address.countryCode !== 'vn') return reject('country_code_not_vn');
  if (
    address.country &&
    !['viet nam', 'vietnam'].includes(normalizeAdministrativeSearch(address.country))
  )
    return reject('conflicting_country');
  const sameProvince = (name: string) => findProvince(name)?.code === province.code;
  const sameWard = (name: string) => findWard(province.code, name)?.code === ward.code;
  for (const { field, name } of address.provinceLevels) {
    if (!sameProvince(name)) return reject(`conflicting_${field}`);
  }

  let wardMatched = false;
  const isSubwardLabel = (name: string) =>
    /^(khu pho|to dan pho|khu dan cu|ap|thon)\s+/.test(normalizeAdministrativeSearch(name));
  for (const { field, name } of address.wardLevels) {
    if (sameWard(name)) wardMatched = true;
    // Provider suburb/quarter sometimes describe an older district or a smaller
    // community. An explicit ward field never gets this exception.
    else if (field !== 'ward' && (isDistrictLabel(name) || isSubwardLabel(name))) continue;
    else return reject(`conflicting_${field}`);
  }
  for (const { field, name } of address.localLevels) {
    if (sameWard(name)) wardMatched = true;
    else if (isWardLabel(name) || findWard(province.code, name))
      return reject(`conflicting_${field}`);
    // An unclassified local name is not proof of either a match or a conflict.
  }
  for (const { field, name } of address.intermediateLevels) {
    if (!sameProvince(name) && !sameWard(name) && !isDistrictLabel(name))
      warnings.push(`provider_hierarchy_anomaly:${field}`);
  }
  // A soft anomaly may only be overridden by affirmative structured ward proof;
  // a display-name match or the ambiguous city level cannot supply that proof.
  if (warnings.length && !wardMatched) return reject('hierarchy_anomaly_without_ward_match');
  return { warnings };
}
