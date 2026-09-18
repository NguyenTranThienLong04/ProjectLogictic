import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AddressSearchService } from './address-search.service.js';
import { AddressSearchDto } from './dto/address-search.dto.js';

const input = { street: '123 Nguyễn Trãi', city: 'Hồ Chí Minh', ward: 'Bến Thành' };
const valid = {
  place_id: '123',
  lat: '10.77',
  lon: '106.69',
  display_name: '123 Nguyễn Trãi',
  address: { country_code: 'vn', road: 'Nguyễn Trãi' },
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
    expect(url.searchParams.get('q')).toBe('123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh, Vietnam');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
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
  it.each([
    { street: '', city: 'HCM' },
    { street: '   ', city: 'HCM' },
    { street: 123, city: 'HCM' },
    { street: '123', city: '' },
    { ...input, url: 'https://evil.test' },
    { ...input, street: 'x'.repeat(256) },
  ])('rejects invalid DTO with 400', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: AddressSearchDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('trims and normalizes input', async () => {
    expect(
      await pipe.transform(
        { street: '  123   Nguyễn Trãi ', city: ' Hồ Chí Minh ' },
        { type: 'body', metatype: AddressSearchDto },
      ),
    ).toEqual({ street: input.street, city: input.city });
  });
});
