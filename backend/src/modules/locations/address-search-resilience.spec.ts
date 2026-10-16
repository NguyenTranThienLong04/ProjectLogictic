import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AddressSearchService, evaluateAddressCandidate } from './address-search.service.js';
import { AddressSearchDto } from './dto/address-search.dto.js';
import { findProvince, findWard } from '../../common/addresses/administrative-data.js';
import { splitSearchStreet } from './address-search-policy.js';
import captured from './fixtures/locationiq-resilience.json' with { type: 'json' };

const input = { street: '475A Điện Biên Phủ', city: 'Hồ Chí Minh', ward: 'Thanh Mỹ Tây' };
const province = findProvince(input.city)!;
const selected = { province, ward: findWard(province.code, input.ward)! };
const house = {
  place_id: 'house-fixture',
  lat: String(selected.ward.latitude),
  lon: String(selected.ward.longitude),
  address: {
    country_code: 'vn',
    house_number: '475a',
    road: 'Đường Điện Biên Phủ',
    state: 'Hồ Chí Minh',
    suburb: 'Phường 25',
    city: 'Bình Thạnh',
  },
};
const road = {
  ...house,
  place_id: 'road-fixture',
  class: 'highway',
  address: { ...house.address, house_number: undefined },
};

describe('address search resilience', () => {
  const nativeFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof jest.fn<typeof fetch>>;
  const increment = jest.fn(() =>
    Promise.resolve({ totalHits: 1, timeToExpire: 1, isBlocked: false, timeToBlockExpire: 0 }),
  );
  let service: AddressSearchService;
  beforeEach(() => {
    fetchMock = jest
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('[]')));
    globalThis.fetch = fetchMock;
    increment.mockClear();
    service = new AddressSearchService(
      new ConfigService({ LOCATIONIQ_API_KEY: 'fixture-secret' }),
      { increment },
    );
  });
  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  it('A/B: full query fails, suffix house succeeds without obsolete ward rejection', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetchMock.mockResolvedValueOnce(Response.json([house]));
    expect(await service.search(input)).toEqual([
      expect.objectContaining({
        precision: 'HOUSE',
        houseNumber: '475a',
        administrativeMismatch: true,
      }),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get('q'))).toEqual([
      '475A Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam',
      '475A Điện Biên Phủ, Hồ Chí Minh, Việt Nam',
    ]);
    expect(increment).toHaveBeenCalledTimes(6);
  });
  it('tries at most four distinct sequential queries, dropping house and ward progressively', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([]));
    fetchMock.mockResolvedValueOnce(Response.json([]));
    fetchMock.mockResolvedValueOnce(Response.json([]));
    fetchMock.mockResolvedValueOnce(Response.json([road]));
    const results = await service.search(input);
    expect(results[0]).toMatchObject({ precision: 'STREET', administrativeMismatch: true });
    expect(results[0].displayName).not.toContain('475');
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get('q'))).toEqual([
      '475A Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam',
      '475A Điện Biên Phủ, Hồ Chí Minh, Việt Nam',
      'Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam',
      'Điện Biên Phủ, Hồ Chí Minh, Việt Nam',
    ]);
    expect(
      new Set(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get('viewbox'))).size,
    ).toBe(1);
    expect(increment).toHaveBeenCalledTimes(12);
  });
  it('C/D: retains distinct road segments, deduplicates coordinates/houses and caps suggestions', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([
        house,
        { ...house, place_id: 'same-address', lat: String(selected.ward.latitude + 0.0001) },
        ...Array.from({ length: 8 }, (_, index) => ({
          ...road,
          place_id: `segment-${index}`,
          lat: String(selected.ward.latitude + 0.001 * index),
        })),
      ]),
    );
    const results = await service.search(input);
    expect(results).toHaveLength(5);
    expect(results[0].precision).toBe('HOUSE');
    expect(new Set(results.map((item) => `${item.latitude},${item.longitude}`)).size).toBe(5);
    expect(results.some((item) => item.id === 'same-address')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('E: no usable result terminates without fabricating a coordinate', async () => {
    expect(await service.search(input)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('deduplicates queries when no house is supplied', async () => {
    expect(await service.search({ ...input, street: 'Điện Biên Phủ' })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('permits absent ward for search only, requires province evidence, and never invents ward metadata', async () => {
    const noWard = { street: input.street, city: input.city };
    const parsed: unknown = await new ValidationPipe({ transform: true }).transform(noWard, {
      type: 'body',
      metatype: AddressSearchDto,
    });
    fetchMock.mockResolvedValueOnce(Response.json([house]));
    const [result] = await service.search(parsed as AddressSearchDto);
    expect(result.ward).toBeUndefined();
    expect(result.city).toBe(input.city);
    expect(
      evaluateAddressCandidate(
        { ...house, address: { ...house.address, state: undefined } },
        noWard,
        { province },
      ),
    ).toMatchObject({ rejection: 'missing_province_evidence' });
  });
  it.each(['475A Điện Biên Phủ', '475a Dien Bien Phu', '475A Điện Biên Phủ'])(
    'preserves suffix and compares accented/unaccented/NFC road: %s',
    (street) => {
      expect(
        evaluateAddressCandidate(house, { ...input, street }, selected).result?.precision,
      ).toBe('HOUSE');
    },
  );
  it('preserves alley/range numbers without address-specific cases', () => {
    expect(splitSearchStreet(' 45/2A   Lê Lai ')).toEqual({ houseNumber: '45/2A', road: 'Lê Lai' });
    expect(splitSearchStreet('12-14, Tràng Tiền')).toEqual({
      houseNumber: '12-14',
      road: 'Tràng Tiền',
    });
  });
  it('normalizes provider Phố prefixes and legacy eth without conflating different roads', () => {
    expect(
      evaluateAddressCandidate(
        { ...house, address: { ...house.address, road: 'Ðiện Biên Phủ' } },
        input,
        selected,
      ).result,
    ).toBeDefined();
    const hanoi = findProvince('Hà Nội')!;
    const context = { province: hanoi, ward: findWard(hanoi.code, 'Cửa Nam')! };
    const request = { street: '1 Tràng Tiền', ward: 'Cửa Nam', city: 'Hà Nội' };
    const candidate = {
      ...house,
      lat: '21.0256337',
      lon: '105.8518593',
      address: {
        country_code: 'vn',
        house_number: '1',
        road: 'Phố Tràng Tiền',
        city: 'Hà Nội',
      },
    };
    expect(evaluateAddressCandidate(candidate, request, context).result?.precision).toBe('HOUSE');
    expect(
      evaluateAddressCandidate(
        { ...candidate, address: { ...candidate.address, road: 'Phố Bà Triệu' } },
        request,
        context,
      ).rejection,
    ).toBe('street_or_house_mismatch');
  });
  it.each([
    { ...road, class: 'place' },
    { ...road, address: { ...road.address, road: undefined } },
    { ...road, address: { ...road.address, house_number: '476' } },
    { ...road, address: { ...road.address, state: 'Hà Nội' } },
    { ...road, lat: '21.01' },
  ])('rejects locality-only, wrong house/province or outside-region results', (candidate) => {
    expect(evaluateAddressCandidate(candidate, input, selected).result).toBeUndefined();
  });
  it('accepts the captured real street-level results as approximate, with actual coordinates', () => {
    const target = captured.cases.find((item) => item.input.street === input.street)!;
    const raw = target.attempts[1].raw;
    const results = raw
      .map((item) => evaluateAddressCandidate(item, input, selected).result)
      .filter(Boolean);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result?.precision).toBe('STREET');
      expect(result?.displayName).not.toContain('475A');
      expect(
        raw.some(
          (item) =>
            Number(Number(item.lat).toFixed(6)) === result?.latitude &&
            Number(Number(item.lon).toFixed(6)) === result?.longitude,
        ),
      ).toBe(true);
    }
  });
  it('F: cancellation aborts the in-flight provider request and prevents further fallbacks', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const signal = options?.signal;
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
      return Response.json([]);
    });
    const pending = service.search(input, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
    // Let the three asynchronous quota checks finish before disconnecting.
    for (let index = 0; index < 5; index++) await Promise.resolve();
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it.each([429, 503])(
    'stops immediately on provider %s, without fallback amplification',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response('private upstream details', { status }));
      await expect(service.search(input)).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
