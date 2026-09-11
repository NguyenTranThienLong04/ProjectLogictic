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

export function checkHistory(manifest, rows, allowPending = false) {
  const names = Object.keys(manifest.migrations).sort();
  const applied = new Set();
  for (const row of rows) {
    assert.ok(names.includes(row.migration_name), `Unknown migration: ${row.migration_name}`);
    if (row.rolled_back_at) continue;
    assert.ok(row.finished_at, `Unresolved failed migration: ${row.migration_name}`);
    assert.ok(!applied.has(row.migration_name), `Duplicate successful migration: ${row.migration_name}`);
    assert.equal(row.checksum, manifest.migrations[row.migration_name], `Applied checksum mismatch: ${row.migration_name}`);
    applied.add(row.migration_name);
  }
  const ordered = names.filter((name) => applied.has(name));
  assert.deepEqual(ordered, names.slice(0, ordered.length), 'Applied migrations are not a canonical prefix');
  if (!allowPending) assert.equal(applied.size, names.length, 'Pending migrations remain');
  return applied.size;
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL(manifestPath, root), 'utf8'));
  const names = (await readdir(new URL(directory, root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(names, Object.keys(manifest.migrations).sort(), 'Manifest must cover every migration exactly');
  for (const name of names) {
    assert.equal(sha256(await readFile(new URL(`${directory}${name}/migration.sql`, root))),
      manifest.migrations[name], `Canonical file checksum mismatch: ${name}`);
  }
  assert.equal(sha256(await readFile(new URL(`${directory}migration_lock.toml`, root))), manifest.lock);
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
    const exists = await client.query("SELECT to_regclass('public._prisma_migrations') AS relation");
    let rows = [];
    if (exists.rows[0].relation) {
      ({ rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'));
    } else {
      const objects = await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S','p') UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'");
      assert.equal(objects.rowCount, 0, 'Unmanaged nonempty database; reconciliation required');
    }
    const count = checkHistory(manifest, rows, process.argv.includes('--allow-pending'));
    await client.query('ROLLBACK');
    console.log(`PASS read-only database history: ${count}/${names.length} canonical migrations applied`);
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
