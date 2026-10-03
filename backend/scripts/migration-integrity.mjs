import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = new URL('../../', import.meta.url);
const manifestPath = 'backend/prisma/migrations.manifest.json';
const directory = 'backend/prisma/migrations/';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Explicit historical evidence, scoped to the staging target audited on 2026-10-03.
// See docs/PHASE1_LEGACY_CHECKSUM_EXCEPTION.md. Never repair the database ledger.
const legacyTarget = Object.freeze({
  hostname: 'ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech',
  port: '5432',
  database: 'neondb',
  tlsVerified: true,
});
const legacyChecksums = Object.freeze({
  '20260907170000_phase_h2_shipping_fee_reconciliation': Object.freeze({
    historical: 'b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f',
    canonical: '4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb',
  }),
  '20260907210000_phase_h3_shipping_fee_online_payment': Object.freeze({
    historical: 'f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386',
    canonical: '8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228',
  }),
});

export function createLegacyStagingContext(directUrl, actualDatabase, tlsVerified) {
  const url = new URL(directUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Legacy exception requires PostgreSQL');
  assert.equal(url.hostname, legacyTarget.hostname, 'Legacy exception target hostname differs');
  assert.equal(url.port || '5432', legacyTarget.port, 'Legacy exception target port differs');
  assert.equal(url.pathname, `/${legacyTarget.database}`, 'Legacy exception target database differs');
  assert.equal(actualDatabase, legacyTarget.database, 'Legacy exception connected database differs');
  assert.equal(url.searchParams.get('sslmode'), 'verify-full', 'Legacy exception requires verify-full TLS');
  assert.equal(tlsVerified, true, 'Legacy exception requires an authorized TLS certificate');
  return legacyTarget;
}

export async function checkCanonicalMigrationFiles(manifest) {
  const names = (await readdir(new URL(directory, root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(names, Object.keys(manifest.migrations).sort(), 'Manifest must cover every migration exactly');
  for (const name of names) {
    assert.equal(sha256(await readFile(new URL(`${directory}${name}/migration.sql`, root))),
      manifest.migrations[name], `Canonical file checksum mismatch: ${name}`);
  }
  assert.equal(sha256(await readFile(new URL(`${directory}migration_lock.toml`, root))), manifest.lock);
  return names;
}

export function compareBaseline(current, baseline) {
  assert.equal(current.lock, baseline.lock, 'Migration provider lock changed');
  const oldNames = Object.keys(baseline.migrations).sort();
  for (const name of oldNames) {
    assert.equal(current.migrations[name], baseline.migrations[name], `Committed migration changed/deleted: ${name}`);
  }
  for (const name of Object.keys(current.migrations)) {
    assert.ok(name in baseline.migrations || name > oldNames.at(-1), `Migration must append after baseline: ${name}`);
  }
}

export function inspectHistory(manifest, rows, allowPending = false, legacyContext = null) {
  if (legacyContext) {
    assert.deepEqual(legacyContext, legacyTarget, 'Legacy exception scope differs from audited staging target');
    for (const [name, expected] of Object.entries(legacyChecksums)) {
      assert.equal(manifest.migrations[name], expected.canonical, `Legacy exception canonical checksum changed: ${name}`);
    }
  }
  const names = Object.keys(manifest.migrations).sort();
  const applied = new Set();
  const legacyExceptions = [];
  for (const row of rows) {
    assert.ok(names.includes(row.migration_name), `Unknown migration: ${row.migration_name}`);
    if (row.rolled_back_at) continue;
    assert.ok(row.finished_at, `Unresolved failed migration: ${row.migration_name}`);
    assert.ok(!applied.has(row.migration_name), `Duplicate successful migration: ${row.migration_name}`);
    if (row.checksum !== manifest.migrations[row.migration_name]) {
      const expected = legacyContext && Object.hasOwn(legacyChecksums, row.migration_name)
        ? legacyChecksums[row.migration_name] : null;
      assert.ok(expected && row.checksum === expected.historical,
        `Applied checksum mismatch: ${row.migration_name}`);
      legacyExceptions.push(row.migration_name);
    }
    applied.add(row.migration_name);
  }
  const ordered = names.filter((name) => applied.has(name));
  assert.deepEqual(ordered, names.slice(0, ordered.length), 'Applied migrations are not a canonical prefix');
  if (!allowPending) assert.equal(applied.size, names.length, 'Pending migrations remain');
  return {
    appliedCount: applied.size,
    legacyExceptions,
    status: legacyExceptions.length ? 'PASS_WITH_LEGACY_EXCEPTION' : 'PASS',
  };
}

export function checkHistory(manifest, rows, allowPending = false, legacyContext = null) {
  return inspectHistory(manifest, rows, allowPending, legacyContext).appliedCount;
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL(manifestPath, root), 'utf8'));
  const legacyOptIn = process.argv.includes('--legacy-staging-h2-h3');
  assert.ok(!legacyOptIn || process.argv.includes('--database'), 'Legacy exception requires --database');
  const names = await checkCanonicalMigrationFiles(manifest);
  const base = process.env.MIGRATION_BASE_REF;
  if (base) {
    assert.match(base, /^[a-f0-9]{40}$/, 'Base must be a full trusted Git commit SHA');
    const git = (...args) => execFileSync('git', args, { cwd: fileURLToPath(root), stdio: ['ignore', 'pipe', 'pipe'] });
    const paths = git('ls-tree', '-r', '--name-only', base).toString().trim().split('\n');
    if (paths.includes(manifestPath)) {
      compareBaseline(manifest, JSON.parse(git('show', `${base}:${manifestPath}`).toString()));
    } else {
      // One-time adoption: freeze the exact pre-I2 Git tree, including the documented Phase 5 repair.
      assert.equal(base, manifest.bootstrap.commit, 'Unrecognized pre-manifest baseline');
      for (const path of paths.filter((path) => path.startsWith(directory) && path.endsWith('/migration.sql'))) {
        const name = path.split('/').at(-2);
        const previous = sha256(git('show', `${base}:${path}`));
        assert.equal(previous, manifest.bootstrap.migrations[name], `Bootstrap baseline changed: ${name}`);
        if (previous !== manifest.migrations[name]) {
          assert.equal(name, '20260820100000_phase5_last_mile_delivery', 'Undocumented bootstrap mutation');
        }
      }
    }
  } else if (process.env.CI === 'true' && !process.argv.includes('--database')) {
    throw new Error('CI requires MIGRATION_BASE_REF; do not silently skip committed-history validation');
  }
  console.log(`PASS canonical migration files: ${names.length}; Git baseline: ${base ? 'checked' : 'not requested'}`);
  if (!process.argv.includes('--database')) return;
  assert.ok(process.env.DIRECT_URL, 'DIRECT_URL required; no .env fallback');
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let legacyContext = null;
    if (legacyOptIn) {
      const { rows: [database] } = await client.query('SELECT current_database() AS name');
      legacyContext = createLegacyStagingContext(process.env.DIRECT_URL, database.name,
        client.connection.stream.authorized === true);
    }
    const exists = await client.query("SELECT to_regclass('public._prisma_migrations') AS relation");
    let rows = [];
    if (exists.rows[0].relation) {
      ({ rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'));
    } else {
      const objects = await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S','p') UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'");
      assert.equal(objects.rowCount, 0, 'Unmanaged nonempty database; reconciliation required');
    }
    const result = inspectHistory(manifest, rows, process.argv.includes('--allow-pending'), legacyContext);
    await client.query('ROLLBACK');
    console.log(`${result.status} read-only database history: ${result.appliedCount}/${names.length} migrations applied; legacy exceptions: ${result.legacyExceptions.join(', ') || 'none'}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Connection errors can include credentials: only assertion messages are safe to print.
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Migration gate failed; check configuration/connectivity and restricted runner logs.');
    process.exitCode = 1;
  });
}
