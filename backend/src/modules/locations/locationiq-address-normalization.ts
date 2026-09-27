// LocationIQ normalizeaddress=1 levels describe the provider hierarchy, not our
// canonical two-level catalogue. In particular, city is NOT a province alias.
// https://docs.locationiq.com/reference/search-structured#normalizeaddress
type ProviderLevel = { field: string; name: string };
export interface LocationIqAddress {
  countryCode?: string;
  country?: string;
  houseNumber?: string;
  road?: string;
  provinceLevels: ProviderLevel[];
  wardLevels: ProviderLevel[];
  localLevels: ProviderLevel[];
  intermediateLevels: ProviderLevel[];
}

export function normalizeLocationIqAddress(address: Record<string, unknown>): LocationIqAddress {
  const text = (field: string): string | undefined => {
    const value = address[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const levels = (fields: string[]): ProviderLevel[] =>
    fields.flatMap((field) => {
      const name = text(field);
      return name ? [{ field, name }] : [];
    });
  return {
    countryCode: text('country_code')?.toLowerCase(),
    country: text('country'),
    houseNumber: text('house_number'),
    road: text('road'),
    provinceLevels: levels(['state', 'province', 'region']),
    wardLevels: levels(['ward', 'suburb', 'quarter']),
    // A neighbourhood can be a ward-equivalent OR a smaller community such as
    // Khu phố 3. The policy must distinguish these, not invent an admin level.
    localLevels: levels(['neighbourhood', 'neighborhood', 'village', 'locality', 'hamlet']),
    intermediateLevels: levels([
      'city',
      'city_district',
      'borough',
      'municipality',
      'county',
      'town',
      'district',
      'state_district',
    ]),
  };
}
