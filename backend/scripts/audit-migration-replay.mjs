import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

// Only disposable local audit databases are accepted; never fall back to .env.
const urls = [process.env.AUDIT_DATABASE_URL, process.env.AUDIT_SHADOW_DATABASE_URL];
for (const value of urls) {
  if (!value) throw new Error('AUDIT_DATABASE_URL and AUDIT_SHADOW_DATABASE_URL are required');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/i1_[a-z_]+$/.test(url.pathname)) {
    throw new Error('Migration replay accepts only disposable localhost i1_* databases');
  }
}
if (urls[0] === urls[1]) throw new Error('Replay and shadow must be different databases');
const directory = new URL('../prisma/migrations/', import.meta.url);
const names = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
if (names.length !== 25) throw new Error(`Expected 25 migrations, found ${names.length}`);
const schemas = [];
for (const [index, connectionString] of urls.entries()) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    if (tables.rowCount) throw new Error('Audit replay requires an empty database; no reset is performed');
    for (const name of names) {
      const sql = await readFile(new URL(`${name}/migration.sql`, directory), 'utf8');
      await client.query(sql);
      console.log(`${index === 0 ? 'replay' : 'shadow'} PASS ${name} sha256=${createHash('sha256').update(sql).digest('hex')}`);
    }
    const schema = await client.query(`
      SELECT 'column' AS kind, table_name AS name, column_name AS member,
        concat_ws('|', udt_name, is_nullable, column_default) AS definition
      FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL SELECT 'constraint', c.relname, con.conname, pg_get_constraintdef(con.oid)
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'index', tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL SELECT 'enum', t.typname, e.enumlabel, e.enumsortorder::text
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
      ORDER BY 1, 2, 3`);
    schemas.push(JSON.stringify(schema.rows));
  } finally {
    await client.end();
  }
}
if (schemas[0] !== schemas[1]) throw new Error('Replay/shadow catalog mismatch');
console.log('PASS: 25 SQL migrations replayed independently twice; columns, constraints, indexes and enums match.');
console.log('This SQL replay does not replace Prisma migrate deploy/status or Prisma schema drift validation.');
