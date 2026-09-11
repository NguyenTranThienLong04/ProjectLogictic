import assert from 'node:assert/strict';
import pg from 'pg';

// No .env fallback and no reset: a rerun needs a new disposable PostgreSQL service.
const url = new URL(process.env.CI_DATABASE_ADMIN_URL ?? '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55432');
assert.equal(url.pathname, '/i1_control');
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  for (const name of ['i1_e2e', 'i1_replay', 'i1_shadow', 'i1_sql_a', 'i1_sql_b', 'i1_browser', 'i1_smoke']) {
    await client.query(`CREATE DATABASE "${name}"`);
  }
} finally {
  await client.end();
}
