// Read-only live provider audit. Run after build; pass an explicit local env file.
// Never prints/stores keys, credential URLs or raw fetch exceptions.
import 'reflect-metadata';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AddressSearchService, evaluateAddressCandidate } from '../dist/modules/locations/address-search.service.js';
import { addressSearchViewbox } from '../dist/modules/locations/address-search-policy.js';
import { findProvince, findWard } from '../dist/common/addresses/administrative-data.js';

const envFile = process.argv[2];
if (!envFile) throw new Error('Pass the local env-file path explicitly');
const env = parseEnv(await readFile(envFile, 'utf8'));
const key = env.LOCATIONIQ_API_KEY?.trim();
if (!key) throw new Error('LOCATIONIQ_API_KEY is not configured in the supplied env file');
const input = { street: '123 Nguyễn Trãi', ward: 'Bến Thành', city: 'Hồ Chí Minh' };
const province = findProvince(input.city);
const ward = findWard(province.code, input.ward);
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
      attempt.evaluations = raw.map((row) => ({
        placeId: row.place_id,
        ...evaluateAddressCandidate(row, input, selected),
      }));
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
await writeFile('test-results/locationiq-hierarchy-live.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
