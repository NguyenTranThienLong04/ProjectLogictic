import {
  findProvince,
  findWard,
  normalizeAdministrativeSearch,
  type Province,
  type Ward,
} from '../../common/addresses/administrative-data.js';

export type SelectedAdministration = { province: Province; ward: Ward };

const value = (address: Record<string, unknown>, field: string): string | undefined =>
  typeof address[field] === 'string' && address[field].trim() ? address[field].trim() : undefined;
const isWardLabel = (name: string): boolean =>
  /^(phuong|xa|dac khu)\s+|\s+(ward|commune)$/.test(normalizeAdministrativeSearch(name));
const isProvinceLabel = (name: string): boolean =>
  /^(thanh pho|tinh|tp[. ]+)\s*|\s+city$/.test(normalizeAdministrativeSearch(name));
const isDistrictLabel = (name: string): boolean =>
  /^(quan|huyen|district)\s+|\s+district$/.test(normalizeAdministrativeSearch(name));

// This snapshot contains approximate centres, not administrative boundaries.
// A viewbox biases the provider; it must never substitute for hierarchy validation.
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

export function matchesSelectedAdministration(
  address: Record<string, unknown>,
  displayName: string,
  { province, ward }: SelectedAdministration,
): boolean {
  if (value(address, 'country_code')?.toLowerCase() !== 'vn') return false;
  const country = value(address, 'country');
  if (country && !['viet nam', 'vietnam'].includes(normalizeAdministrativeSearch(country)))
    return false;

  const sameProvince = (name: string) => findProvince(name)?.code === province.code;
  const sameWard = (name: string) =>
    findWard(
      province.code,
      normalizeAdministrativeSearch(name)
        .replace(/^(thanh pho|tp\.)\s+/, '')
        .replace(/\s+city$/, ''),
    )?.code === ward.code;
  let provinceMatched = false;
  let wardMatched = false;

  for (const field of ['state', 'province']) {
    const name = value(address, field);
    if (!name) continue;
    if (!sameProvince(name)) return false;
    provinceMatched = true;
  }

  // Provider levels vary: city can be the province, selected locality or a legacy
  // district. A different municipality (e.g. Thành phố Thủ Đức) is not a match.
  for (const field of ['city', 'town', 'municipality']) {
    const name = value(address, field);
    if (!name) continue;
    if (sameProvince(name)) provinceMatched = true;
    else if (sameWard(name)) wardMatched = true;
    else if (!isDistrictLabel(name)) return false;
  }

  for (const field of [
    'ward',
    'quarter',
    'suburb',
    'village',
    'locality',
    'neighbourhood',
    'hamlet',
    'city_district',
    'district',
    'borough',
    'county',
    'state_district',
  ]) {
    const name = value(address, field);
    if (!name) continue;
    if (sameWard(name)) {
      wardMatched = true;
      continue;
    }
    if (['county', 'state_district'].includes(field) && sameProvince(name)) {
      provinceMatched = true;
      continue;
    }
    if (isWardLabel(name) || isProvinceLabel(name)) return false;
    if (field !== 'ward' && isDistrictLabel(name)) continue;
    if (['ward', 'quarter', 'suburb', 'village', 'locality'].includes(field)) return false;
    // A named canonical locality in another provider level is contradictory too.
    const otherWard = findWard(province.code, name);
    const otherProvince = findProvince(name);
    if (otherWard || (otherProvince && otherProvince.code !== province.code)) return false;
  }

  // Do not repair conflicting text while retaining its coordinate. Display text
  // may veto a candidate, but cannot supply missing structured administrative proof.
  let afterSelectedWard = false;
  for (const part of displayName.split(',').map((part) => part.trim())) {
    if (isWardLabel(part) && !sameWard(part)) return false;
    if (isProvinceLabel(part) && !sameProvince(part) && !sameWard(part)) return false;
    // Past the ward, bare canonical names are parent hierarchy, not street/POI
    // names. E.g. "Bến Thành, Thủ Đức, Hồ Chí Minh" is contradictory as well.
    if (sameWard(part)) afterSelectedWard = true;
    else if (
      afterSelectedWard &&
      !sameProvince(part) &&
      (findWard(province.code, part) || findProvince(part))
    )
      return false;
  }
  return provinceMatched && wardMatched;
}
