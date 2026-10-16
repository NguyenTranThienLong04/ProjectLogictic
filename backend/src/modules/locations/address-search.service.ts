import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressSearchDto } from './dto/address-search.dto.js';
import { findProvince, findWard } from '../../common/addresses/administrative-data.js';
import {
  addressSearchViewbox,
  assessAdministration,
  isInAddressSearchArea,
  matchesSearchStreet,
  splitSearchStreet,
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
  precision: 'HOUSE' | 'STREET';
  providerLocality?: string;
  administrativeMismatch: boolean;
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
  // Only actual road features may stand in for an unknown house. A locality,
  // POI with no house number, or an explicitly different house is not a match.
  const streetFeature = row?.class === 'highway' || row?.category === 'highway';
  if (!matchesSearchStreet(normalized, input.street, streetFeature))
    return { rejection: 'street_or_house_mismatch' };
  const precision = normalized.houseNumber ? 'HOUSE' : 'STREET';
  const administrativeMismatch = warnings.some((warning) =>
    warning.startsWith('provider_ward_mismatch:'),
  );
  const providerLocality = [
    ...new Set(
      [...normalized.localLevels, ...normalized.wardLevels, ...normalized.intermediateLevels].map(
        ({ name }) => name,
      ),
    ),
  ].join(', ');
  return {
    warnings,
    result: {
      id,
      // Never label a road centroid as the requested house number.
      displayName: [
        precision === 'HOUSE'
          ? [normalized.houseNumber, splitSearchStreet(input.street).road].join(' ')
          : normalized.road,
        !administrativeMismatch ? selected.ward?.fullName : undefined,
        selected.province.name,
      ]
        .filter(Boolean)
        .join(', '),
      latitude,
      longitude,
      houseNumber: normalized.houseNumber,
      road: normalized.road,
      ward: selected.ward?.name,
      city: selected.province.name,
      precision,
      providerLocality: providerLocality || undefined,
      administrativeMismatch,
    },
  };
}

@Injectable()
export class AddressSearchService {
  constructor(
    private readonly config: ConfigService,
    @Inject(ThrottlerStorage) private readonly limiter: ThrottlerStorage,
  ) {}

  async search(input: AddressSearchDto, signal?: AbortSignal): Promise<AddressSearchResult[]> {
    const province = findProvince(input.city);
    const ward = findWard(province?.code, input.ward);
    if (!province || (input.ward && !ward))
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
    const street = input.street.normalize('NFC').trim().replace(/\s+/g, ' ');
    const { road } = splitSearchStreet(street);
    const queries = [
      ...new Set(
        [[street, ward?.name], [street], [road, ward?.name], [road]].map((parts) =>
          [...parts, province.name, 'Việt Nam'].filter(Boolean).join(', '),
        ),
      ),
    ];
    const requestStarts: number[] = [];
    for (const q of queries) {
      signal?.throwIfAborted();
      // Do not let a fast four-attempt lookup exhaust its own two/sec allowance.
      // Concurrent clients still share the authoritative account limiter below.
      if (requestStarts.length >= 2) {
        const previousPair = requestStarts[requestStarts.length - 2];
        await delay(Math.max(0, 1100 - (Date.now() - previousPair)), undefined, { signal });
      }
      requestStarts.push(Date.now());
      const url = new URL('https://us1.locationiq.com/v1/search');
      url.search = new URLSearchParams({ ...common, q }).toString();
      const results = (await this.request(url, signal))
        .flatMap((item) => {
          const evaluation = evaluateAddressCandidate(item, input, selected);
          return evaluation.result ? [evaluation.result] : [];
        })
        .sort(
          (a, b) =>
            Number(b.precision === 'HOUSE') - Number(a.precision === 'HOUSE') ||
            Number(a.administrativeMismatch) - Number(b.administrativeMismatch),
        );
      const seenCoordinates = new Set<string>();
      const seenAddresses = new Set<string>();
      const unique = results.filter((result) => {
        const coordinates = `${result.latitude},${result.longitude}`;
        // Preserve distinct road segments; they can share a label but have
        // different coordinates. House duplicates also need the same locality.
        const address = `${result.displayName}|${result.providerLocality ?? ''}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        if (
          seenCoordinates.has(coordinates) ||
          (result.precision === 'HOUSE' && seenAddresses.has(address))
        )
          return false;
        seenCoordinates.add(coordinates);
        if (result.precision === 'HOUSE') seenAddresses.add(address);
        return true;
      });
      if (unique.length) return unique.slice(0, 5);
    }
    return [];
  }

  private async request(url: URL, signal?: AbortSignal): Promise<unknown[]> {
    signal?.throwIfAborted();
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
      response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
        redirect: 'error',
      });
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
