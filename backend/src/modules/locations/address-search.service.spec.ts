import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AddressSearchService } from './address-search.service.js';
import { AddressSearchDto } from './dto/address-search.dto.js';
import { CreateAddressDto } from '../addresses/dto/create-address.dto.js';
import { UpdateAddressDto } from '../addresses/dto/update-address.dto.js';
import { QuoteAddressDto } from '../pricing/dto/quote-address.dto.js';

const input = { street: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành' };
const valid = {
  place_id: '123',
  lat: '10.77',
  lon: '106.69',
  display_name: '123 Nguyễn Trãi',
  address: {
    country_code: 'vn',
    road: 'Nguyễn Trãi',
    state: 'Hồ Chí Minh',
    suburb: 'Phường Bến Thành',
  },
};
describe('address search', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof jest.fn<typeof fetch>>;
  let storage: ThrottlerStorageService;
  let service: AddressSearchService;
  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    storage = new ThrottlerStorageService();
    service = new AddressSearchService(
      new ConfigService({ LOCATIONIQ_API_KEY: 'test-secret-key' }),
      storage,
    );
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    storage.onApplicationShutdown();
  });
  it('restricts VN, builds structured query, normalizes and filters invalid results', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          valid,
          { ...valid, lat: '91' },
          { ...valid, lon: '181' },
          { ...valid, lat: null },
          { ...valid, lat: '' },
          { ...valid, lon: 'NaN' },
          { ...valid, address: { country_code: 'us' } },
        ]),
      ),
    );
    expect(await service.search(input)).toEqual([
      expect.objectContaining({
        id: '123',
        latitude: 10.77,
        longitude: 106.69,
        road: 'Nguyễn Trãi',
      }),
    ]);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBeInstanceOf(URL);
    const url = calledUrl as URL;
    expect(url.origin + url.pathname).toBe('https://us1.locationiq.com/v1/search');
    expect(url.searchParams.get('countrycodes')).toBe('vn');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('q')).toBe(
      '123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh, Vietnam',
    );
    expect(url.searchParams.get('viewbox')).toBe('106.644103,10.720000,106.745897,10.820000');
    expect(url.searchParams.get('bounded')).toBe('0');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('rejects Thu Duc for 123 Nguyễn Trãi + Hồ Chí Minh + Bến Thành, preserving only the matching pin', async () => {
    const thuDuc = {
      ...valid,
      place_id: 'thu-duc',
      lat: '10.851',
      lon: '106.759',
      display_name: '123 Nguyễn Trãi, Thành phố Thủ Đức, Hồ Chí Minh, Việt Nam',
      address: { ...valid.address, city: 'Thành phố Thủ Đức', suburb: 'Linh Chiểu' },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify([thuDuc, valid])));
    expect(await service.search(input)).toEqual([
      expect.objectContaining({
        id: valid.place_id,
        latitude: 10.77,
        longitude: 106.69,
        displayName: valid.display_name,
      }),
    ]);
  });
  it.each([
    ['wrong province', { state: 'Hà Nội' }],
    ['wrong ward', { suburb: 'Phường Sài Gòn' }],
    ['same street in another area', { suburb: 'Linh Chiểu', city: 'Thủ Đức' }],
    ['contradictory city with matching ward', { city: 'Thành phố Thủ Đức' }],
    ['contradictory county with matching ward', { county: 'Thành phố Thủ Đức' }],
    ['contradictory district with matching ward', { district: 'Thành phố Thủ Đức' }],
    ['conflicting province/city', { city: 'Hà Nội' }],
    ['conflicting locality', { locality: 'Thủ Đức' }],
    ['conflicting explicit ward in neighbourhood', { neighbourhood: 'Phường Sài Gòn' }],
    ['conflicting explicit ward in hamlet', { hamlet: 'Phường Sài Gòn' }],
    ['missing ward', { suburb: undefined }],
    ['missing province', { state: undefined }],
    ['wrong country', { country_code: 'us' }],
    ['conflicting country', { country: 'Singapore' }],
  ])('returns no match for %s even when street matches', async (_label, address) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ ...valid, address: { ...valid.address, ...address } }])),
    );
    expect(await service.search(input)).toEqual([]);
  });
  it.each([
    '123 Nguyễn Trãi, Phường Bến Thành, Thành phố Thủ Đức, Hồ Chí Minh',
    '123 Nguyễn Trãi, Phường Sài Gòn, Hồ Chí Minh',
    '123 Nguyễn Trãi, Bến Thành, Thành phố Hà Nội',
    '123 Nguyễn Trãi, Bến Thành, Thủ Đức, Hồ Chí Minh',
    '123 Nguyễn Trãi, Bến Thành, Hà Nội',
  ])('rejects contradictory display hierarchy without rewriting it: %s', async (display_name) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ ...valid, display_name }])));
    expect(await service.search(input)).toEqual([]);
  });
  it.each([
    { state: 'Ho Chi Minh City', suburb: 'Ben Thanh', city: 'Quận 1' },
    { city: 'TP. Hồ Chí Minh', quarter: 'Bến Thành' },
    { state: 'Thành phố Hồ Chí Minh', locality: 'Bến Thành' },
    { state: 'Hồ Chí Minh', city: 'Bến Thành' },
    { state: 'Hồ Chí Minh', suburb: 'Ben Thanh Ward' },
    { state: 'Hồ Chí Minh', suburb: 'Quận 1', quarter: 'Bến Thành' },
    { county: 'Thành phố Hồ Chí Minh', suburb: 'Bến Thành' },
  ])(
    'accepts compatible provider hierarchy and retains exact candidate coordinate',
    async (address) => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              ...valid,
              lat: '10.7695084',
              lon: '106.6907953',
              address: { country_code: 'vn', ...address },
            },
          ]),
        ),
      );
      expect(await service.search(input)).toEqual([
        expect.objectContaining({
          latitude: 10.769508,
          longitude: 106.690795,
          displayName: valid.display_name,
        }),
      ]);
    },
  );
  it('resolves canonical names and ignores legacy district in the provider query', async () => {
    fetchMock.mockResolvedValue(new Response('[]'));
    await service.search({
      ...input,
      city: 'TP. Hồ Chí Minh',
      ward: 'Phường Bến Thành',
      district: 'Thành phố Thủ Đức',
    });
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('q')).toBe(
      '123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh, Vietnam',
    );
  });
  it('accepts Thu Duc only when it is the selected canonical ward (no place-name blacklist)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            ...valid,
            lat: '10.851',
            lon: '106.759',
            display_name: '123 Nguyễn Trãi, Phường Thủ Đức, Hồ Chí Minh',
            address: {
              country_code: 'vn',
              state: 'Hồ Chí Minh',
              city: 'Thành phố Thủ Đức',
              suburb: 'Thủ Đức',
            },
          },
        ]),
      ),
    );
    expect(await service.search({ ...input, ward: 'Thủ Đức' })).toEqual([
      expect.objectContaining({ latitude: 10.851, longitude: 106.759 }),
    ]);
  });
  it.each([
    { ...input, city: 'Unknown' },
    { ...input, city: 'Hà Nội' },
    { ...input, ward: '' },
    { ...input, ward: 'Unknown' },
  ])('rejects noncanonical selections before contacting provider', async (selection) => {
    await expect(service.search(selection)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([429, 500, 503, 401])('sanitizes upstream %s', async (status) => {
    fetchMock.mockResolvedValue(new Response('test-secret-key private body', { status }));
    await expect(service.search(input)).rejects.toMatchObject({
      status: status === 429 ? 429 : 503,
    });
  });
  it.each(['not json', '{"error":"test-secret-key"}'])(
    'rejects malformed response safely',
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(service.search(input)).rejects.toMatchObject({
        message: 'Address search is unavailable',
      });
    },
  );
  it('sanitizes timeout/network exceptions', async () => {
    fetchMock.mockRejectedValue(new Error('timeout https://provider?key=test-secret-key'));
    await expect(service.search(input)).rejects.toMatchObject({
      message: 'Address search is unavailable',
      status: 503,
    });
  });
  it('returns empty results for provider no match', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    expect(await service.search(input)).toEqual([]);
  });
  it('enforces the account-wide per-second limit before fetching', async () => {
    fetchMock.mockResolvedValue(new Response('[]'));
    await service.search(input);
    fetchMock.mockResolvedValue(new Response('[]'));
    await service.search(input);
    await expect(service.search(input)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('disables search without a key', async () => {
    const disabled = new AddressSearchService(new ConfigService(), storage);
    await expect(disabled.search(input)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it.each([CreateAddressDto, UpdateAddressDto, QuoteAddressDto])(
    'keeps provider precision compatible with %p without DTO coercion',
    async (metatype) => {
      // Raw coordinate strings observed in a live LocationIQ response.
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify([{ ...valid, lat: '10.7695084', lon: '106.6907953' }])),
      );
      const [result] = await service.search(input);
      expect(typeof result.latitude).toBe('number');
      expect(typeof result.longitude).toBe('number');
      const body = {
        ...(metatype === QuoteAddressDto ? {} : { label: 'Home' }),
        contactName: 'Test Customer',
        phone: '0901234567',
        streetAddress: '123 Street',
        ward: 'Ben Thanh',
        district: '',
        city: 'Ho Chi Minh',
        latitude: result.latitude,
        longitude: result.longitude,
      };
      await expect(pipe.transform(body, { type: 'body', metatype })).resolves.toMatchObject({
        latitude: 10.769508,
        longitude: 106.690795,
      });
    },
  );
  it.each(['lat', 'lon'])('filters malformed %s before normalization', async (field) => {
    for (const value of [
      'NaN',
      'Infinity',
      '-Infinity',
      '10.7oops',
      '',
      ' ',
      null,
      true,
      [],
      {},
      field === 'lat' ? '90.0000001' : '180.0000001',
      field === 'lat' ? '-90.0000001' : '-180.0000001',
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ ...valid, [field]: value }])));
      // A fresh limiter keeps this parser test independent of account quotas.
      const parser = new AddressSearchService(new ConfigService({ LOCATIONIQ_API_KEY: 'test' }), {
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 1,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      });
      await expect(parser.search(input)).resolves.toEqual([]);
    }
  });
  it.each([
    { street: '', city: 'HCM' },
    { street: '   ', city: 'HCM' },
    { street: 123, city: 'HCM' },
    { street: '123', city: '' },
    { ...input, url: 'https://evil.test' },
    { ...input, street: 'x'.repeat(256) },
    { ...input, ward: undefined },
    { ...input, ward: ' ' },
  ])('rejects invalid DTO with 400', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: AddressSearchDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('trims and normalizes input', async () => {
    expect(
      await pipe.transform(
        { street: '  123   Nguyễn Trãi ', city: ' Hồ Chí Minh ', ward: ' Bến Thành ' },
        { type: 'body', metatype: AddressSearchDto },
      ),
    ).toEqual(input);
  });
});
