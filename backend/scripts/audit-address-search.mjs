// Read-only live provider audit. Run after build; pass an explicit local env file.
// Never prints/stores keys, credential URLs or raw fetch exceptions.
import 'reflect-metadata';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AddressSearchService, evaluateAddressCandidate } from '../dist/modules/locations/address-search.service.js';
import { addressSearchViewbox, assessAdministration, isInAddressSearchArea, matchesSearchStreet } from '../dist/modules/locations/address-search-policy.js';
import { findProvince, findWard } from '../dist/common/addresses/administrative-data.js';
import { normalizeLocationIqAddress } from '../dist/modules/locations/locationiq-address-normalization.js';

const envFile = process.argv[2];
if (!envFile) throw new Error('Pass the local env-file path explicitly');
const env = parseEnv(await readFile(envFile, 'utf8'));
const key = env.LOCATIONIQ_API_KEY?.trim();
if (!key) throw new Error('LOCATIONIQ_API_KEY is not configured in the supplied env file');
// Optional JSON lets regression audits reproduce the exact form payload without
// editing product policy or overwriting evidence from an earlier address.
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))
    throw new Error(`Missing value for ${name}`);
  return process.argv[index + 1];
};
const inputFile = argument('--input');
const outputFile = argument('--output') ?? 'test-results/locationiq-hierarchy-live.json';
if (!/^test-results\/[a-zA-Z0-9_-]+\.json$/.test(outputFile))
  throw new Error('Output must be a JSON filename directly under test-results/');
const input = inputFile
  ? JSON.parse(await readFile(inputFile, 'utf8'))
  : { street: '123 Nguyễn Trãi', ward: 'Bến Thành', city: 'Hồ Chí Minh' };
if (['street', 'ward', 'city'].some((field) => typeof input[field] !== 'string' || !input[field].trim()))
  throw new Error('Input requires non-empty street, ward and city strings');
const province = findProvince(input.city);
const ward = findWard(province?.code, input.ward);
if (!province || !ward) throw new Error('Input must select a canonical province and ward');
const selected = { province, ward };
const evidence = {
  at: new Date().toISOString(),
  scope: 'Local compiled backend against live LocationIQ; NOT deployed staging API/browser',
  input,
  area: { center: { latitude: ward.latitude, longitude: ward.longitude }, viewbox: addressSearchViewbox(selected), polygon: false },
  attempts: [],
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const safeParams = new URLSearchParams(url.search);
  safeParams.delete('key');
  const attempt = { endpoint: url.origin + url.pathname, parameters: Object.fromEntries(safeParams) };
  evidence.attempts.push(attempt);
  try {
    const response = await nativeFetch(url, options);
    attempt.status = response.status;
    const raw = await response.clone().json().catch(() => null);
    if (Array.isArray(raw)) {
      attempt.rawCandidates = raw;
      attempt.evaluations = raw.map((row) => {
        const normalizedAddress = row?.address && typeof row.address === 'object' && !Array.isArray(row.address)
          ? normalizeLocationIqAddress(row.address)
          : null;
        return {
          placeId: row?.place_id,
          normalizedAddress,
          // Independent diagnostics reuse product policy. The evaluator below
          // remains authoritative and reports its first rejecting gate.
          checks: normalizedAddress ? {
            rawCoordinateInsideSearchArea: isInAddressSearchArea(Number(row.lat), Number(row.lon), selected),
            administration: assessAdministration(normalizedAddress, selected),
            streetAndHouseMatch: matchesSearchStreet(normalizedAddress, input.street),
          } : null,
          ...evaluateAddressCandidate(row, input, selected),
        };
      });
    } else if (response.status === 404) {
      // The provider's not-found response contains no candidate to normalize.
      attempt.rawCandidates = [];
      attempt.evaluations = [];
      attempt.outcome = 'provider_not_found';
    }
    return response;
  } catch {
    attempt.error = 'Provider network request failed (details redacted)';
    throw new Error(attempt.error);
  }
};
const storage = new ThrottlerStorageService();
try {
  if (process.argv.includes('--compare-before')) {
    const before = new URL('https://us1.locationiq.com/v1/search');
    before.search = new URLSearchParams({
      key, q: [input.street, ward.fullName, province.name, 'Vietnam'].join(', '),
      format: 'json', countrycodes: 'vn', limit: '5', addressdetails: '1',
      'accept-language': 'vi', viewbox: addressSearchViewbox(selected), bounded: '0',
    }).toString();
    await fetch(before, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    await delay(1100);
  }
  const service = new AddressSearchService({ get: () => key }, storage);
  evidence.selectable = await service.search(input);
  evidence.liveTarget = evidence.selectable.length ? 'PASS' : 'FAIL: no selectable candidate';
} catch (error) {
  evidence.liveTarget = 'FAIL: request unavailable';
  evidence.errorStatus = typeof error.getStatus === 'function' ? error.getStatus() : undefined;
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  storage.onApplicationShutdown();
}
await mkdir('test-results', { recursive: true });
await writeFile(outputFile, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
