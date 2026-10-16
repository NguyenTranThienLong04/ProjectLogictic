import {
  findProvince,
  findWard,
  getProvinceWards,
  normalizeAdministrativeSearch,
  type Province,
  type Ward,
} from '../../common/addresses/administrative-data.js';

import type { LocationIqAddress } from './locationiq-address-normalization.js';

export type SelectedAdministration = { province: Province; ward?: Ward };

const isWardLabel = (name: string): boolean =>
  /^(phuong|xa|dac khu)\s+|\s+(ward|commune)$/.test(normalizeAdministrativeSearch(name));
const isDistrictLabel = (name: string): boolean =>
  /^(quan|huyen|district)\s+|\s+district$/.test(normalizeAdministrativeSearch(name));

// This snapshot contains approximate centres, not administrative boundaries.
// Reuse this search window for retrieval AND containment. With no ward selected,
// the catalogue's ward centres define a province search envelope, NOT a polygon
// or proof of service eligibility. No geographic data is invented or persisted.
export function addressSearchViewbox({ province, ward }: SelectedAdministration): string {
  const points = ward ? [ward] : getProvinceWards(province.code);
  const latitudeDelta = 0.05;
  const longitudeDelta = latitudeDelta / Math.cos(((ward ?? province).latitude * Math.PI) / 180);
  return [
    Math.min(...points.map((point) => point.longitude)) - longitudeDelta,
    Math.min(...points.map((point) => point.latitude)) - latitudeDelta,
    Math.max(...points.map((point) => point.longitude)) + longitudeDelta,
    Math.max(...points.map((point) => point.latitude)) + latitudeDelta,
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

// Keep the house token separate without discarding suffixes or alley numbers.
export function splitSearchStreet(street: string): { houseNumber?: string; road: string } {
  const value = street.normalize('NFC').trim().replace(/\s+/g, ' ');
  const house = value.match(/^(\d+[a-z]?(?:[/-]\d+[a-z]?)*)(?:\s*,\s*|\s+)(.+)$/i);
  return house ? { houseNumber: house[1], road: house[2] } : { road: value };
}

export function matchesSearchStreet(
  address: LocationIqAddress,
  street: string,
  allowStreet = false,
): boolean {
  const normalizeRoad = (name: string) =>
    normalizeAdministrativeSearch(name)
      // Some OSM names use Latin eth (Ð) instead of Vietnamese Đ.
      .replace(/ð/g, 'd')
      .replace(/^(duong|pho|street)\s+/, '')
      .replace(/\s+street$/, '');
  const requested = splitSearchStreet(street);
  const road = address.road;
  if (!road || normalizeRoad(road) !== normalizeRoad(requested.road)) return false;
  return (
    !requested.houseNumber ||
    (allowStreet && !address.houseNumber) ||
    normalizeAdministrativeSearch(address.houseNumber ?? '') ===
      normalizeAdministrativeSearch(requested.houseNumber)
  );
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
  const sameWard = (name: string) =>
    Boolean(ward && findWard(province.code, name)?.code === ward.code);
  for (const { field, name } of address.provinceLevels) {
    if (!sameProvince(name)) return reject(`conflicting_${field}`);
  }

  const isSubwardLabel = (name: string) =>
    /^(khu pho|to dan pho|khu dan cu|ap|thon)\s+/.test(normalizeAdministrativeSearch(name));
  for (const { field, name } of address.wardLevels) {
    if (!ward || sameWard(name)) continue;
    // Provider suburb/quarter sometimes describe an older district or a smaller
    // community. An explicit ward field never gets this exception.
    else if (field !== 'ward' && (isDistrictLabel(name) || isSubwardLabel(name))) continue;
    else warnings.push(`provider_ward_mismatch:${field}`);
  }
  for (const { field, name } of address.localLevels) {
    if (!ward || sameWard(name)) continue;
    else if (isWardLabel(name) || findWard(province.code, name))
      warnings.push(`provider_ward_mismatch:${field}`);
    // An unclassified local name is not proof of either a match or a conflict.
  }
  for (const { field, name } of address.intermediateLevels) {
    if (!sameProvince(name) && !sameWard(name) && !isDistrictLabel(name))
      warnings.push(`provider_hierarchy_anomaly:${field}`);
  }
  // Provider ward/intermediate labels may lag the canonical catalogue. Street
  // evidence plus coordinate containment is mandatory at the caller instead.
  // A province-wide search needs positive province evidence as well.
  if (
    !ward &&
    ![...address.provinceLevels, ...address.intermediateLevels].some(({ name }) =>
      sameProvince(name),
    )
  )
    return reject('missing_province_evidence');
  return { warnings };
}
