import { HttpException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { AddressSearchDto } from './dto/address-search.dto.js';

export interface AddressSearchResult {
  id: string;
  displayName: string;
  latitude: number;
  longitude: number;
  houseNumber?: string;
  road?: string;
  ward?: string;
  city?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : undefined;
const coordinate = (value: unknown, max: number): number | undefined => {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > max) return;
  // Internal address DTOs accept six decimal places. Check the original range
  // first so rounding cannot turn an invalid provider coordinate into a valid one.
  return Number(number.toFixed(6));
};

@Injectable()
export class AddressSearchService {
  constructor(
    private readonly config: ConfigService,
    @Inject(ThrottlerStorage) private readonly limiter: ThrottlerStorage,
  ) {}

  async search(input: AddressSearchDto): Promise<AddressSearchResult[]> {
    const key = this.config.get<string>('LOCATIONIQ_API_KEY');
    if (!key) throw new ServiceUnavailableException('Address search is unavailable');
    // Account-wide limits in addition to the controller's per-client throttle.
    // The existing Redis storage supplies its single-instance fallback on outages.
    for (const [window, ttl, limit] of [
      ['second', 1000, 2],
      ['minute', 60_000, 60],
      ['day', 86_400_000, 5000],
    ] as const) {
      const result = await this.limiter.increment(
        `locationiq:${window}`,
        ttl,
        limit,
        ttl,
        'address-search',
      );
      if (result.isBlocked)
        throw new HttpException(
          {
            code: 'ADDRESS_SEARCH_RATE_LIMITED',
            message: 'Address search limit reached. Try again later.',
          },
          429,
        );
    }
    const url = new URL('https://us1.locationiq.com/v1/search');
    url.search = new URLSearchParams({
      key,
      q: [input.street, input.ward, input.district, input.city, 'Vietnam']
        .filter(Boolean)
        .join(', '),
      format: 'json',
      countrycodes: 'vn',
      limit: '5',
      addressdetails: '1',
      'accept-language': 'vi',
    }).toString();
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (response.status === 404) return [];
      if (response.status === 429)
        throw new HttpException(
          {
            code: 'ADDRESS_SEARCH_RATE_LIMITED',
            message: 'Address search limit reached. Try again later.',
          },
          429,
        );
      if (!response.ok) throw new Error('Upstream unavailable');
      body = await response.json();
      if (!Array.isArray(body)) throw new Error('Invalid upstream response');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Never retain/log a fetch exception: it can contain the URL and credential.
      throw new ServiceUnavailableException('Address search is unavailable');
    }
    const results: AddressSearchResult[] = [];
    for (const item of body as unknown[]) {
      const row = record(item);
      const address = record(row?.address);
      if (text(address?.country_code)?.toLowerCase() !== 'vn') continue;
      const latitude = coordinate(row?.lat, 90);
      const longitude = coordinate(row?.lon, 180);
      const displayName = text(row?.display_name);
      const id =
        typeof row?.place_id === 'number' && Number.isFinite(row.place_id)
          ? String(row.place_id)
          : text(row?.place_id);
      if (latitude === undefined || longitude === undefined || !displayName || !id) continue;
      results.push({
        id,
        displayName,
        latitude,
        longitude,
        houseNumber: text(address?.house_number),
        road: text(address?.road),
        ward: text(address?.quarter) ?? text(address?.suburb),
        city: text(address?.city) ?? text(address?.state),
      });
      if (results.length === 5) break;
    }
    return results;
  }
}
