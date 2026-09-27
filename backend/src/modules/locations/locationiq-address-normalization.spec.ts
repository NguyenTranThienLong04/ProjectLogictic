import 'reflect-metadata';
import { normalizeLocationIqAddress } from './locationiq-address-normalization.js';
import { evaluateAddressCandidate } from './address-search.service.js';
import { findProvince, findWard } from '../../common/addresses/administrative-data.js';
import { matchesSearchStreet } from './address-search-policy.js';

const input = { street: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành' };
const province = findProvince(input.city)!;
const selected = { province, ward: findWard(province.code, input.ward)! };
const live = {
  place_id: '257000422',
  lat: '10.7695084',
  lon: '106.6907953',
  display_name:
    '123, Đường Nguyễn Trãi, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, 70200, Việt Nam',
  address: {
    house_number: '123',
    road: 'Đường Nguyễn Trãi',
    neighbourhood: 'Khu phố 3',
    suburb: 'Phường Bến Thành',
    city: 'Thành phố Thủ Đức',
    country: 'Việt Nam',
    country_code: 'vn',
  },
};

describe('LocationIQ hierarchy semantics', () => {
  it('rejects the observed Bình Chánh fallback locality for the exact house query', () => {
    // Live provider capture 2026-09-27: structured 404, fallback locality only.
    const requested = {
      street: '14/13a đường số 4 khu phố 2',
      ward: 'Bình Chánh',
      city: 'Hồ Chí Minh',
    };
    const candidate = {
      place_id: '332108734773',
      lat: '10.69541',
      lon: '106.59128',
      display_name: 'Tân Túc, Binh Chanh, Thành phố Hồ Chí Minh, Việt Nam',
      address: {
        city: 'Tân Túc',
        county: 'Binh Chanh',
        state: 'Thành phố Hồ Chí Minh',
        country: 'Việt Nam',
        country_code: 'vn',
      },
    };
    expect(
      evaluateAddressCandidate(candidate, requested, {
        province,
        ward: findWard(province.code, requested.ward)!,
      }),
    ).toEqual({ rejection: 'hierarchy_anomaly_without_ward_match' });
    // Even absent the hierarchy rejection, this is not house/road evidence.
    expect(
      matchesSearchStreet(normalizeLocationIqAddress(candidate.address), requested.street),
    ).toBe(false);
  });
  it('keeps raw city out of canonical province evidence', () => {
    const normalized = normalizeLocationIqAddress(live.address);
    expect(normalized.provinceLevels).toEqual([]);
    expect(normalized.wardLevels).toContainEqual({ field: 'suburb', name: 'Phường Bến Thành' });
    expect(normalized.intermediateLevels).toEqual([{ field: 'city', name: 'Thành phố Thủ Đức' }]);
  });
  it('accepts the observed live house with a warning and canonical label, preserving its coordinate', () => {
    expect(evaluateAddressCandidate(live, input, selected)).toEqual({
      warnings: ['provider_hierarchy_anomaly:city'],
      result: {
        id: '257000422',
        displayName: '123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh',
        latitude: 10.769508,
        longitude: 106.690795,
        houseNumber: '123',
        road: 'Đường Nguyễn Trãi',
        ward: 'Bến Thành',
        city: 'Hồ Chí Minh',
      },
    });
  });
  it.each(['city', 'city_district', 'borough', 'municipality', 'county', 'town', 'district'])(
    '%s is a soft intermediate level when stronger evidence matches',
    (field) => {
      const candidate = {
        ...live,
        address: { ...live.address, city: undefined, [field]: 'Thành phố Thủ Đức' },
      };
      expect(evaluateAddressCandidate(candidate, input, selected)).toMatchObject({
        result: { id: live.place_id },
        warnings: [`provider_hierarchy_anomaly:${field}`],
      });
    },
  );
  it.each(['state', 'province', 'region'])(
    'explicit wrong %s cannot be overridden by any matching signals',
    (field) => {
      expect(
        evaluateAddressCandidate(
          { ...live, address: { ...live.address, [field]: 'Hà Nội' } },
          input,
          selected,
        ),
      ).toEqual({ rejection: `conflicting_${field}` });
    },
  );
  it.each([
    'ward',
    'suburb',
    'quarter',
    'neighbourhood',
    'neighborhood',
    'locality',
    'village',
    'hamlet',
  ])('explicit wrong ward in %s cannot be overridden', (field) => {
    expect(
      evaluateAddressCandidate(
        { ...live, address: { ...live.address, [field]: 'Phường Sài Gòn' } },
        input,
        selected,
      ),
    ).toEqual({ rejection: `conflicting_${field}` });
  });
  it.each(['ward', 'suburb', 'quarter', 'neighbourhood'])(
    'recognizes an unaccented ward-equivalent in %s',
    (field) => {
      const address = {
        ...live.address,
        suburb: undefined,
        neighbourhood: undefined,
        [field]: 'Ben Thanh Ward',
      };
      expect(evaluateAddressCandidate({ ...live, address }, input, selected).result).toBeDefined();
    },
  );
  it('rejects an anomaly without affirmative ward evidence even if display_name claims the selected ward', () => {
    const address = { ...live.address, suburb: undefined };
    expect(evaluateAddressCandidate({ ...live, address }, input, selected)).toEqual({
      rejection: 'hierarchy_anomaly_without_ward_match',
    });
  });
  it.each([
    { lat: '10.851', lon: '106.759' },
    { lat: '10.77', lon: '106.75' },
  ])(
    'rejects same road outside selected bounds even with exact matching ward text',
    (coordinates) => {
      expect(evaluateAddressCandidate({ ...live, ...coordinates }, input, selected)).toEqual({
        rejection: 'outside_search_area',
      });
    },
  );
  it.each([{ house_number: '124' }, { road: 'Nguyễn Huệ' }])(
    'requires house/road match despite ward proof',
    (fields) => {
      expect(
        evaluateAddressCandidate(
          { ...live, address: { ...live.address, ...fields } },
          input,
          selected,
        ),
      ).toEqual({ rejection: 'street_or_house_mismatch' });
    },
  );
  it('applies the same policy to another house/road without relying on display_name or special addresses', () => {
    const candidate = {
      ...live,
      display_name: undefined,
      address: { ...live.address, house_number: '45/2A', road: 'Đường Lê Lai' },
    };
    expect(
      evaluateAddressCandidate(candidate, { ...input, street: '45/2A Lê Lai' }, selected),
    ).toMatchObject({
      result: {
        displayName: '45/2A Lê Lai, Phường Bến Thành, Hồ Chí Minh',
        latitude: 10.769508,
        longitude: 106.690795,
      },
    });
  });
});
