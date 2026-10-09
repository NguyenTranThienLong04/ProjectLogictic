import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Reuse production-component browser checks; HTTP fixtures complement the real DB journeys.
const root = fileURLToPath(new URL('../../', import.meta.url));
const checks = [
  ['Control Tower + deep-links', 'control-tower/check.mjs'],
  ['Auth refresh / F5 / multi-tab', 'auth-restore/check.mjs'],
  ['Auth warehouse scope cache', 'auth-cache/check.mjs'],
  ['Notification navigation / pending and failed mark-read', 'ui-flow/check.mjs'],
  ['Notification deep-link reload', 'ui-flow/notification-reload.mjs'],
  ['Warehouse + Line-haul strict / compatibility', 'ui-flow/canonical-flow.mjs'],
  ['Warehouse transfer pagination beyond 100', 'warehouse-transfer-pagination.mjs'],
];
const results = [];
mkdirSync(new URL('../../test-results/browser-regression/', import.meta.url), { recursive: true });
for (const [name, file] of checks) {
  console.log(`BROWSER_REGRESSION START ${name}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [`frontend/test/${file}`], {
    cwd: root, env: process.env, stdio: 'inherit', timeout: 300_000,
  });
  const passed = !result.error && result.status === 0;
  results.push({ name, file, passed, durationMs: Date.now() - started, error: result.error?.message, signal: result.signal });
  writeFileSync(new URL('../../test-results/browser-regression/results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  console.log(`BROWSER_REGRESSION ${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) process.exit(1);
}
console.log(`BROWSER_REGRESSION PASS ${results.length}/${checks.length}`);
