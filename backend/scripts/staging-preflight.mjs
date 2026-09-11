import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { checkHistory } from './migration-integrity.mjs';

// Explicit file only: never load development .env or mutate either database.
const file = process.argv[2];
if (!file) throw new Error('Pass the local staging env-file path explicitly');
const environment = dotenv.parse(readFileSync(resolve(file)));
const manifest = JSON.parse(readFileSync(new URL('../prisma/migrations.manifest.json', import.meta.url)));
const identity = (url) => `${url.hostname.replace('-pooler.', '.')}:${url.port || '5432'}${url.pathname}`;
let failed = false;

try {
  const urls = Object.fromEntries(['DATABASE_URL', 'DIRECT_URL', 'SHADOW_DATABASE_URL'].map((key) => {
    assert.ok(environment[key], `${key} missing`);
    const url = new URL(environment[key]);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), `${key} protocol invalid`);
    assert.equal(url.searchParams.get('sslmode'), 'verify-full', `${key} requires verified TLS`);
    assert.ok(url.hostname.endsWith('.neon.tech'), `${key} must target Neon`);
    return [key, url];
  }));
  assert.ok(urls.DATABASE_URL.hostname.includes('-pooler.'), 'DATABASE_URL requires pooled endpoint');
  assert.ok(!urls.DIRECT_URL.hostname.includes('-pooler.'), 'DIRECT_URL requires direct endpoint');
  assert.ok(!urls.SHADOW_DATABASE_URL.hostname.includes('-pooler.'), 'SHADOW_DATABASE_URL requires direct endpoint');
  assert.equal(identity(urls.DATABASE_URL), identity(urls.DIRECT_URL), 'Runtime and migration databases differ');
  assert.notEqual(identity(urls.DIRECT_URL), identity(urls.SHADOW_DATABASE_URL), 'Shadow targets main database');
  assert.equal(urls.DIRECT_URL.pathname, '/neondb', 'Unexpected staging main database');
  assert.equal(urls.SHADOW_DATABASE_URL.pathname, '/logistics_shadow', 'Unexpected shadow database');
  console.log('PASS Neon URL topology, database separation and verify-full configuration');

  for (const [key, url] of Object.entries(urls)) {
    const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000, query_timeout: 15000, application_name: 'logistics-i3-readonly-preflight' });
    try {
      await client.connect();
      assert.equal(client.connection.stream.authorized, true, 'TLS certificate not authorized');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [database] } = await client.query('SELECT current_database() AS name');
      assert.equal(database.name, decodeURIComponent(url.pathname.slice(1)), 'Connected database differs from URL');
      const { rows: [extension] } = await client.query("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='btree_gist') AS available, EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS installed, has_database_privilege(current_user,current_database(),'CREATE') AS can_create, EXISTS(SELECT 1 FROM pg_available_extension_versions WHERE name='btree_gist' AND trusted) AS trusted");
      assert.ok(extension.available && (extension.installed || (extension.can_create && extension.trusted)), 'btree_gist unavailable or insufficient CREATE privilege');
      const { rows: [objects] } = await client.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','v','m','S','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')");
      const { rows: [history] } = await client.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present");
      let applied = 0;
      if (history.present) {
        const { rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at');
        applied = checkHistory(manifest, rows, true);
      } else {
        assert.equal(objects.count, 0, 'Unmanaged nonempty database; do not migrate/reset');
      }
      if (key === 'SHADOW_DATABASE_URL') assert.equal(objects.count, 0, 'Shadow is not empty; do not reset');
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ connection: key, tlsCertificateVerified: true, database: database.name, btreeGist: extension, relationCount: objects.count, canonicalApplied: applied, readOnly: true }));
    } catch (error) {
      failed = true;
      // Raw driver errors and connection strings must never reach output.
      const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNCLASSIFIED';
      console.error(`${key}: FAIL ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : code}`);
    } finally {
      await client.end().catch(() => { failed = true; });
    }
  }
} catch (error) {
  failed = true;
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Staging configuration invalid; values withheld');
}
process.exitCode = failed ? 1 : 0;
