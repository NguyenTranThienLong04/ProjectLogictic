import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDisposablePostgresDatabase } from './disposable-database.ts';

test('accepts the local regression runner and explicit CI E2E database family', () => {
  for (const DATABASE_URL of [
    'postgresql://127.0.0.1:55432/p0_regression_1791384902',
    'postgres://localhost:55432/p0_regression_1791384902',
  ]) assert.doesNotThrow(() => assertDisposablePostgresDatabase({ DATABASE_URL }));
  for (const name of ['i1_e2e', 'i1_browser', 'i1_smoke', 'i1_e2e_1791384902']) {
    assert.doesNotThrow(() => assertDisposablePostgresDatabase({
      DATABASE_URL: `postgresql://ci:test@127.0.0.1:55432/${name}`, CI: 'true',
    }));
  }
});

test('rejects production/staging-like names even on loopback with CI enabled', () => {
  for (const name of ['production', 'staging', 'neondb', 'postgres', 'i1_production', 'i1_staging',
    'p0_regression_staging', 'p0_regression_', 'i1_e2e_staging', 'i1_e2e/production']) {
    assert.throws(() => assertDisposablePostgresDatabase({
      DATABASE_URL: `postgresql://127.0.0.1:55432/${name}`, CI: 'true',
    }), /E2E requires PostgreSQL/);
  }
});

test('CI names require explicit CI=true', () => {
  for (const CI of [undefined, '', 'false', '1', 'TRUE']) {
    assert.throws(() => assertDisposablePostgresDatabase({
      DATABASE_URL: 'postgresql://127.0.0.1:55432/i1_e2e', CI,
    }), /E2E requires PostgreSQL/);
  }
});

test('rejects remote targets, ordinary PostgreSQL ports, and URL routing overrides', () => {
  for (const DATABASE_URL of [
    'postgresql://staging.example.test:55432/i1_e2e',
    'postgresql://production.example.test:55432/p0_regression_123',
    'postgresql://localhost.example.test:55432/i1_e2e',
    'postgresql://localhost:5432/i1_e2e',
    'postgresql://localhost/i1_e2e',
    'https://localhost:55432/i1_e2e',
    'postgresql://localhost:55432/i1_e2e?host=staging.example.test',
    'postgresql://localhost:55432/i1_e2e?dbname=production',
    'postgresql://localhost:55432/i1_e2e?port=5432',
    'postgresql://localhost:55432/i1_e2e#production',
  ]) assert.throws(() => assertDisposablePostgresDatabase({ DATABASE_URL, CI: 'true' }), /E2E requires PostgreSQL/);
});

test('missing/malformed URLs fail closed without exposing credentials', () => {
  for (const DATABASE_URL of [undefined, '', 'invalid', 'postgresql://user:private-secret@']) {
    assert.throws(() => assertDisposablePostgresDatabase({ DATABASE_URL, CI: 'true' }), error => {
      assert.match(error.message, /E2E requires PostgreSQL/);
      assert.ok(!error.message.includes('private-secret'));
      return true;
    });
  }
});
