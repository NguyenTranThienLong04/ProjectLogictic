import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { AddressSearchDto } from './dto/address-search.dto.js';
import { findProvince, findWard } from '../../common/addresses/administrative-data.js';
import {
  addressSearchViewbox,
  assessAdministration,
  isInAddressSearchArea,
  matchesSearchStreet,
  type SelectedAdministration,
} from './address-search-policy.js';
import { normalizeLocationIqAddress } from './locationiq-address-normalization.js';

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

// Shared by retrieval and the read-only provider audit; no raw responses are logged.
export function evaluateAddressCandidate(
  item: unknown,
  input: AddressSearchDto,
  selected: SelectedAdministration,
):
  | { result: AddressSearchResult; warnings: string[]; rejection?: never }
  | { rejection: string; result?: never } {
  const row = record(item);
  const address = record(row?.address);
  const latitude = coordinate(row?.lat, 90);
  const longitude = coordinate(row?.lon, 180);
  if (latitude === undefined || longitude === undefined) return { rejection: 'invalid_coordinate' };
  // Check raw and rounded points so precision normalization cannot cross the window edge.
  if (
    !isInAddressSearchArea(Number(row?.lat), Number(row?.lon), selected) ||
    !isInAddressSearchArea(latitude, longitude, selected)
  )
    return { rejection: 'outside_search_area' };
  const id =
    typeof row?.place_id === 'number' && Number.isFinite(row.place_id)
      ? String(row.place_id)
      : text(row?.place_id);
  if (!id || !address) return { rejection: 'missing_candidate_fields' };
  const normalized = normalizeLocationIqAddress(address);
  const { rejection, warnings } = assessAdministration(normalized, selected);
  if (rejection) return { rejection };
  if (!matchesSearchStreet(normalized, input.street))
    return { rejection: 'street_or_house_mismatch' };
  return {
    warnings,
    result: {
      id,
      displayName: [input.street.trim(), selected.ward.fullName, selected.province.name].join(', '),
      latitude,
      longitude,
      houseNumber: normalized.houseNumber,
      road: normalized.road,
      ward: selected.ward.name,
      city: selected.province.name,
    },
  };
}

@Injectable()
export class AddressSearchService {
  constructor(
    private readonly config: ConfigService,
    @Inject(ThrottlerStorage) private readonly limiter: ThrottlerStorage,
  ) {}

  async search(input: AddressSearchDto): Promise<AddressSearchResult[]> {
    const province = findProvince(input.city);
    const ward = findWard(province?.code, input.ward);
    if (!province || !ward)
      throw new BadRequestException('Select a valid canonical province and ward');
    const selected = { province, ward };
    const key = this.config.get<string>('LOCATIONIQ_API_KEY');
    if (!key) throw new ServiceUnavailableException('Address search is unavailable');
    const common = {
      key,
      format: 'json',
      countrycodes: 'vn',
      limit: '5',
      addressdetails: '1',
      normalizeaddress: '1',
      'accept-language': 'vi',
      viewbox: addressSearchViewbox(selected),
      bounded: '1',
    };
    const structured = new URL('https://us1.locationiq.com/v1/search/structured');
    structured.search = new URLSearchParams({
      ...common,
      street: input.street,
      // Canonical provinces include centrally governed cities: state is the
      // administrative level shared by every province; never send the ward as city.
      state: province.name,
      country: 'Vietnam',
    }).toString();
    const selectable = (body: unknown[]) =>
      body
        .flatMap((item) => {
          const evaluation = evaluateAddressCandidate(item, input, selected);
          return evaluation.result ? [evaluation.result] : [];
        })
        .slice(0, 5);
    const results = selectable(await this.request(structured));
    // No usable structured result (empty/404 or all rejected): one free-form
    // attempt in exactly the SAME area, subject to exactly the same validation.
    if (results.length === 0) {
      const fallback = new URL('https://us1.locationiq.com/v1/search');
      fallback.search = new URLSearchParams({
        ...common,
        q: [input.street, ward.name, province.name, 'Việt Nam'].join(', '),
      }).toString();
      return selectable(await this.request(fallback));
    }
    return results;
  }

  private async request(url: URL): Promise<unknown[]> {
    // Account-wide limits in addition to the controller's per-client throttle.
    // Charge EACH upstream request, including the fallback.
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
      return body as unknown[];
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Never retain/log a fetch exception: it can contain the URL and credential.
      throw new ServiceUnavailableException('Address search is unavailable');
    }
  }
}
