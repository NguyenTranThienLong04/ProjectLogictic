import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';

const environment = dotenv.parse(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
if (environment.NODE_ENV !== 'development') throw new Error('History audit is restricted to configured development');
const client = new pg.Client({ connectionString: environment.DIRECT_URL, connectionTimeoutMillis: 10000 });
if (!environment.DIRECT_URL) throw new Error('Development DIRECT_URL is required');
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at');
  const directory = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  let differences = 0;
  for (const name of names) {
    const sql = await readFile(new URL(`${name}/migration.sql`, directory));
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = rows.filter((row) => row.migration_name === name && row.finished_at && !row.rolled_back_at);
    const state = applied.length === 1 ? (applied[0].checksum === checksum ? 'MATCH' : 'CHECKSUM_MISMATCH') : 'MISSING_OR_AMBIGUOUS';
    if (state !== 'MATCH') differences++;
    console.log(`${state} ${name}`);
  }
  const unresolved = rows.filter((row) => !row.finished_at && !row.rolled_back_at).length;
  const unknown = rows.filter((row) => !names.includes(row.migration_name)).length;
  console.log(`Development history: ${names.length} repository migrations, ${differences} differences, ${unresolved} unresolved failures, ${unknown} unknown rows. No database writes performed.`);
  await client.query('ROLLBACK');
  process.exitCode = differences || unresolved || unknown ? 1 : 0;
} finally {
  await client.end();
}
