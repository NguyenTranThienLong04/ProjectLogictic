// Read-only real-provider matrix. No DB access, stored keys or credential URLs.
// Build backend first, then: node backend/scripts/audit-address-resilience.mjs .env before|after
import 'reflect-metadata';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AddressSearchService, evaluateAddressCandidate } from '../dist/modules/locations/address-search.service.js';
import { findProvince, findWard } from '../dist/common/addresses/administrative-data.js';

const phase = process.argv[3];
if (!process.argv[2] || !['before', 'after'].includes(phase)) throw new Error('Supply env file and before|after');
const key = parseEnv(await readFile(process.argv[2], 'utf8')).LOCATIONIQ_API_KEY?.trim();
if (!key) throw new Error('LOCATIONIQ_API_KEY is not configured');
const cases = [
  { name: 'suffix-new-ward', street: '475A Điện Biên Phủ', ward: 'Thanh Mỹ Tây', city: 'Hồ Chí Minh' },
  { name: 'unaccented', street: '475A Dien Bien Phu', ward: 'Thanh Mỹ Tây', city: 'Hồ Chí Minh' },
  { name: 'no-ward', street: '475A Điện Biên Phủ', city: 'Hồ Chí Minh' },
  { name: 'street-segments', street: 'Điện Biên Phủ', ward: 'Thanh Mỹ Tây', city: 'Hồ Chí Minh' },
  { name: 'existing-house', street: '123 Nguyễn Trãi', ward: 'Bến Thành', city: 'Hồ Chí Minh' },
  { name: 'hanoi-house', street: '1 Tràng Tiền', ward: 'Cửa Nam', city: 'Hà Nội' },
  { name: 'hanoi-shared-road', street: 'Điện Biên Phủ', ward: 'Ba Đình', city: 'Hà Nội' },
  { name: 'alley-locality', street: '14/13a đường số 4 khu phố 2', ward: 'Bình Chánh', city: 'Hồ Chí Minh' },
];
const evidence = { at: new Date().toISOString(), phase, scope: 'Compiled local service + live LocationIQ. No staging/browser/DB claim.', cases: [] };
const nativeFetch = globalThis.fetch;
const storage = new ThrottlerStorageService();
const service = new AddressSearchService({ get: () => key }, storage);
try {
  for (const { name, ...input } of cases) {
    const entry = { name, input, attempts: [] };
    evidence.cases.push(entry);
    const province = findProvince(input.city);
    const selected = { province, ward: findWard(province?.code, input.ward) };
    globalThis.fetch = async (url, options) => {
      // Additional audit-only spacing respects the shared live provider account.
      await delay(1100);
      const parameters = new URLSearchParams(url.search);
      parameters.delete('key');
      const attempt = { endpoint: url.origin + url.pathname, parameters: Object.fromEntries(parameters) };
      entry.attempts.push(attempt);
      try {
        const response = await nativeFetch(url, options);
        attempt.status = response.status;
        attempt.raw = await response.clone().json().catch(() => null);
        attempt.evaluations = Array.isArray(attempt.raw) ? attempt.raw.map((row) => ({
          placeId: row.place_id, ...evaluateAddressCandidate(row, input, selected),
        })) : [];
        return response;
      } catch {
        attempt.error = 'Network failure (details redacted)';
        throw new Error(attempt.error);
      }
    };
    try { entry.selectable = await service.search(input); }
    catch (error) { entry.errorStatus = typeof error.getStatus === 'function' ? error.getStatus() : 'redacted'; }
    console.log(JSON.stringify({ case: name, statuses: entry.attempts.map((a) => a.status), selectable: entry.selectable?.length, errorStatus: entry.errorStatus }));
    if (entry.errorStatus === 429) break;
  }
} finally {
  globalThis.fetch = nativeFetch;
  storage.onApplicationShutdown();
  await mkdir('test-results', { recursive: true });
  const safe = JSON.stringify(evidence, null, 2).replaceAll(key, '[REDACTED]').replaceAll(encodeURIComponent(key), '[REDACTED]');
  await writeFile(`test-results/locationiq-resilience-${phase}.json`, safe + '\n');
}
