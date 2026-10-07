import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkCanonicalMigrationFiles, checkHistory, compareBaseline, createLegacyStagingContext, inspectHistory, sha256 } from './migration-integrity.mjs';

const baseline = { lock: 'postgres', migrations: { '001': sha256('sql\n'), '002': sha256('next') } };
const row = (name) => ({ migration_name: name, checksum: baseline.migrations[name], finished_at: new Date(), rolled_back_at: null });
test('committed migrations cannot be edited, deleted or inserted before the tail', () => {
  assert.throws(() => compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '001': sha256('sql\r\n') } }, baseline));
  assert.throws(() => compareBaseline({ ...baseline, migrations: { '001': baseline.migrations['001'] } }, baseline));
  assert.throws(() => compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '000': 'new' } }, baseline));
  compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '003': 'new' } }, baseline);
});
test('history fails closed for checksum mismatch, unresolved, unknown, duplicate, missing and gaps', () => {
  assert.equal(checkHistory(baseline, [row('001'), row('002')]), 2);
  assert.equal(checkHistory(baseline, [row('001')], true), 1);
  for (const rows of [
    [{ ...row('001'), checksum: 'changed' }], [{ ...row('001'), finished_at: null }],
    [row('unknown')], [row('001'), row('001')], [row('002')],
  ]) assert.throws(() => checkHistory(baseline, rows, true));
  assert.throws(() => checkHistory(baseline, [row('001')]));
  assert.equal(checkHistory(baseline, [{ ...row('001'), finished_at: null, rolled_back_at: new Date() }, row('001'), row('002')]), 2);
});

const canonical = JSON.parse(await readFile(new URL('../prisma/migrations.manifest.json', import.meta.url), 'utf8'));
const h2 = '20260907170000_phase_h2_shipping_fee_reconciliation';
const h3 = '20260907210000_phase_h3_shipping_fee_online_payment';
const historical = {
  [h2]: 'b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f',
  [h3]: 'f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386',
};
// This pure scope validator needs only a target identity, never credentials.
const stagingUrl = 'postgresql://ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech/neondb?sslmode=verify-full';
const stagingContext = createLegacyStagingContext(stagingUrl, 'neondb', true);
const canonicalRows = () => Object.entries(canonical.migrations).map(([migration_name, checksum]) => ({
  migration_name, checksum, finished_at: new Date('2026-10-03T01:14:20.788Z'), rolled_back_at: null,
}));
const legacyRows = () => canonicalRows().map((entry) => ({ ...entry, checksum: historical[entry.migration_name] || entry.checksum }));

test('exact H2/H3 historical and canonical pairs pass only with the audited staging exception', () => {
  const result = inspectHistory(canonical, legacyRows(), false, stagingContext);
  assert.deepEqual(result, {
    appliedCount: Object.keys(canonical.migrations).length,
    legacyExceptions: [h2, h3],
    status: 'PASS_WITH_LEGACY_EXCEPTION',
  });
  assert.throws(() => checkHistory(canonical, legacyRows()), /Applied checksum mismatch/);
  assert.deepEqual(inspectHistory(canonical, canonicalRows(), false, stagingContext), {
    appliedCount: Object.keys(canonical.migrations).length, legacyExceptions: [], status: 'PASS',
  });
  assert.equal(checkHistory(canonical, canonicalRows()), Object.keys(canonical.migrations).length);
});

for (const name of [h2, h3]) {
  test(`${name}: an incorrect historical checksum fails`, () => {
    const rows = legacyRows().map((entry) => entry.migration_name === name
      ? { ...entry, checksum: `${historical[name].slice(0, -1)}0` } : entry);
    assert.throws(() => inspectHistory(canonical, rows, false, stagingContext), /Applied checksum mismatch/);
  });
  test(`${name}: an altered canonical checksum invalidates the exception`, () => {
    const changed = { ...canonical, migrations: { ...canonical.migrations, [name]: sha256('modified migration') } };
    assert.throws(() => inspectHistory(changed, legacyRows(), false, stagingContext), /Legacy exception canonical checksum changed/);
    assert.throws(() => inspectHistory(changed, canonicalRows().map((entry) => entry.migration_name === name
      ? { ...entry, checksum: changed.migrations[name] } : entry), false, stagingContext), /Legacy exception canonical checksum changed/);
    assert.throws(() => compareBaseline(changed, canonical), /Committed migration changed/);
  });
}

test('H2 and H3 historical hashes cannot be swapped or reused for another migration', () => {
  const swapped = legacyRows().map((entry) => entry.migration_name === h2 ? { ...entry, checksum: historical[h3] }
    : entry.migration_name === h3 ? { ...entry, checksum: historical[h2] } : entry);
  assert.throws(() => inspectHistory(canonical, swapped, false, stagingContext), /Applied checksum mismatch/);
  const otherName = Object.keys(canonical.migrations)[0];
  const wrongOther = legacyRows().map((entry) => entry.migration_name === otherName
    ? { ...entry, checksum: historical[h2] } : entry);
  assert.throws(() => inspectHistory(canonical, wrongOther, false, stagingContext), /Applied checksum mismatch/);
});

test('a new migration remains strict when legacy H2/H3 exceptions are active', () => {
  const latestTimestamp = Object.keys(canonical.migrations).sort().at(-1).slice(0, 14);
  const name = `${BigInt(latestTimestamp) + 1n}_new_migration`;
  const next = { ...canonical, migrations: { ...canonical.migrations, [name]: sha256('new SQL') } };
  compareBaseline(next, canonical);
  const newRow = { migration_name: name, checksum: next.migrations[name], finished_at: new Date(), rolled_back_at: null };
  assert.equal(inspectHistory(next, [...legacyRows(), newRow], false, stagingContext).status, 'PASS_WITH_LEGACY_EXCEPTION');
  for (const checksum of [sha256('changed SQL'), historical[h2], historical[h3]]) {
    assert.throws(() => inspectHistory(next, [...legacyRows(), { ...newRow, checksum }], false, stagingContext), /Applied checksum mismatch/);
  }
});

test('another migration cannot be edited in the manifest or applied ledger', async () => {
  const name = Object.keys(canonical.migrations)[0];
  const checksum = sha256('altered unrelated migration');
  const changed = { ...canonical, migrations: { ...canonical.migrations, [name]: checksum } };
  assert.throws(() => compareBaseline(changed, canonical), /Committed migration changed/);
  await assert.rejects(checkCanonicalMigrationFiles(changed), /Canonical file checksum mismatch/);
  assert.throws(() => inspectHistory(canonical, legacyRows().map((entry) => entry.migration_name === name
    ? { ...entry, checksum } : entry), false, stagingContext), /Applied checksum mismatch/);
});

test('legacy exceptions preserve unknown, unresolved, duplicate, prefix and pending guards', () => {
  const rows = legacyRows();
  const cases = [
    [...rows, { ...rows[0], migration_name: 'unknown' }],
    rows.map((entry) => entry.migration_name === h2 ? { ...entry, finished_at: null } : entry),
    [...rows, rows.find((entry) => entry.migration_name === h2)],
    rows.filter((entry) => entry.migration_name !== h2),
    rows.slice(0, -1),
  ];
  for (const candidate of cases) assert.throws(() => inspectHistory(canonical, candidate, false, stagingContext));
  assert.equal(inspectHistory(canonical, rows.slice(0, -1), true, stagingContext).appliedCount, rows.length - 1);
  assert.equal(inspectHistory(canonical, [{ ...rows[0], finished_at: null, rolled_back_at: new Date() }, ...rows], false, stagingContext).appliedCount, rows.length);
});

test('legacy target creation rejects another database, endpoint, port, TLS mode or connection', () => {
  const invalidUrls = [
    stagingUrl.replace('ep-royal-dust-axv3itmx', 'ep-other'),
    stagingUrl.replace('axv3itmx.', 'axv3itmx-pooler.'),
    stagingUrl.replace('/neondb?', '/logistics_shadow?'),
    stagingUrl.replace('.tech/neondb', '.tech:6543/neondb'),
    stagingUrl.replace('verify-full', 'require'),
    'postgresql://127.0.0.1:55432/i1_ci?sslmode=verify-full',
  ];
  for (const url of invalidUrls) assert.throws(() => createLegacyStagingContext(url, 'neondb', true));
  assert.throws(() => createLegacyStagingContext(stagingUrl, 'other', true));
  assert.throws(() => createLegacyStagingContext(stagingUrl, 'neondb', false));
  assert.throws(() => inspectHistory(canonical, legacyRows(), false, { ...stagingContext, hostname: 'other' }));
  assert.throws(() => inspectHistory(canonical, legacyRows(), false, { ...stagingContext, tlsVerified: false }));
});

test('canonical source bytes are verified, including legacy SQL and the provider lock', async () => {
  assert.equal((await checkCanonicalMigrationFiles(canonical)).length, Object.keys(canonical.migrations).length);
  const changed = { ...canonical, migrations: { ...canonical.migrations, [h2]: historical[h2] } };
  await assert.rejects(checkCanonicalMigrationFiles(changed), /Canonical file checksum mismatch/);
  await assert.rejects(checkCanonicalMigrationFiles({ ...canonical, lock: sha256('changed lock') }));
});

test('historical H2/H3 reconstruction preserves every byte except documented transaction additions', async () => {
  const expectedCanonical = {
    [h2]: '4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb',
    [h3]: '8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228',
  };
  for (const name of [h2, h3]) {
    const bytes = await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url));
    assert.equal(sha256(bytes), expectedCanonical[name]);
    const original = bytes.toString('utf8')
      .replace(/^-- PostgreSQL requires new enum values to commit before CHECK constraints use them\.\nBEGIN;\n/, '')
      .replace('COMMIT;\n', '');
    assert.equal(sha256(original), historical[name]);
  }
});
