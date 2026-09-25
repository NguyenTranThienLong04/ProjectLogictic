import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { Redis } from 'ioredis';

// Explicit operator-reviewed target manifest; never infer staging from NODE_ENV
// (the staging server also runs with NODE_ENV=production) or an env filename.
export function requireSafe(condition, message) {
  if (!condition) throw new ResetRefusal(message);
}
class ResetRefusal extends Error {}
export function dbIdentity(value) {
  const u = new URL(value);
  requireSafe(['postgres:', 'postgresql:'].includes(u.protocol), 'Invalid DB protocol');
  requireSafe(!u.searchParams.get('options'), 'DB options are forbidden');
  requireSafe(!u.searchParams.get('schema') || u.searchParams.get('schema') === 'public', 'Only public schema supported');
  return `${u.hostname.replace('-pooler.', '.')}:${u.port || '5432'}${u.pathname}`;
}
export function redisIdentity(value) {
  const u = new URL(value);
  requireSafe(u.protocol === 'rediss:', 'Redis requires TLS');
  requireSafe(!u.search, 'Redis query overrides are forbidden');
  requireSafe(/^\/(\d+)$/.test(u.pathname) || !u.pathname || u.pathname === '/', 'Invalid Redis database');
  return `${u.hostname}:${u.port || '6379'}/${Number(u.pathname.slice(1) || 0)}`;
}
export function executionMode(env) {
  const allow = env.ALLOW_STAGING_RESET;
  const confirm = env.RESET_CONFIRM;
  if (!allow && !confirm) return false;
  requireSafe(allow === 'true' && confirm === 'RESET_STAGING_KEEP_ADMIN', 'Both execution guards must match exactly');
  return true;
}
export function validateTarget(env, target, execute = false) {
  requireSafe(target.environment === 'staging', 'Refusing production/unknown environment');
  requireSafe(target.verifiedBy && target.evidence, 'Missing operator/provider target verification evidence');
  requireSafe(target.redisDedicated === true, 'Redis database must be exclusive to this staging app');
  requireSafe(dbIdentity(env.DATABASE_URL) === target.database, 'Runtime DB does not match verified staging target');
  requireSafe(dbIdentity(env.DIRECT_URL) === target.database, 'Direct DB does not match verified staging target');
  requireSafe(redisIdentity(env.REDIS_URL) === target.redis, 'Redis does not match verified staging target');
  requireSafe(['require', 'verify-full'].includes(new URL(env.DIRECT_URL).searchParams.get('sslmode')), 'Direct DB requires TLS');
  if (execute) {
    requireSafe(typeof target.adminEmail === 'string' && target.adminEmail.includes('@'), 'Verified expected ADMIN email required for execution');
    requireSafe(typeof target.keepAdminId === 'string' && /^[0-9a-f-]{36}$/i.test(target.keepAdminId), 'Verified ADMIN ID required for execution');
    requireSafe(target.deleteOtherAdmins === true, 'Explicit authorization to delete other ADMINs required');
    requireSafe(target.writersStopped === true || target.liveResetAccepted === true, 'Writer quiescence or explicit live-reset acceptance required');
    requireSafe(typeof target.migrationFingerprint === 'string' && /^[0-9a-f]{64}$/.test(target.migrationFingerprint), 'Preflight migration fingerprint required');
    requireSafe(target.expectedBefore && typeof target.expectedBefore === 'object', 'Preflight counts required');
  }
  const api = new URL(target.apiBase);
  requireSafe(api.protocol === 'https:' && !api.username && !api.password && !api.search && !api.hash, 'Verified HTTPS API base required');
}
export function deletionOrder(tables, fks) {
  const pending = new Set(tables);
  const ordered = [];
  while (pending.size) {
    const ready = [...pending].filter(parent => !fks.some(f =>
      pending.has(f.child) && f.parent === parent &&
      !(f.child === 'LineHaulTrip' && f.parent === 'LineHaulTripRoute' && f.column === 'currentRouteId')));
    requireSafe(ready.length > 0, 'Unexpected FK cycle; review schema before reset');
    for (const table of ready) { pending.delete(table); ordered.push(table); }
  }
  return ordered;
}
const quote = value => `"${value.replaceAll('"', '""')}"`;
const tableSql = table => `public.${quote(table)}`;
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emit = value => console.log(JSON.stringify(value));

async function main() {
  let client, redis, inTransaction = false, committed = false;
  try {
    requireSafe(process.argv.length === 4, 'Usage: node backend/scripts/reset-staging-data.mjs <explicit-env-file> <verified-target.json>');
    const env = dotenv.parse(readFileSync(resolve(process.argv[2])));
    const target = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
    const execute = executionMode(process.env);
    validateTarget(env, target, execute);
    emit({ mode: execute ? 'EXECUTE' : 'DRY_RUN', database: target.database, redis: target.redis, apiBase: target.apiBase });
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    requireSafe(!schema.includes('@@map('), 'Mapped models require explicit review');
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]);
    // Neon creates this optional sample table outside Prisma. Keep both its
    // schema and data: the operator explicitly excluded it from reset.
    const reviewedExtraTables = ['playing_with_neon'];
    const verifiedUrl = new URL(env.DIRECT_URL);
    verifiedUrl.searchParams.set('sslmode', 'verify-full');
    client = new pg.Client({ connectionString: verifiedUrl.href, connectionTimeoutMillis: 15000, query_timeout: 60000, application_name: 'staging-reset-keep-admin' });
    // Prevent raw driver errors (which can contain connection details) reaching output.
    client.on('error', () => {});
    await client.connect();
    requireSafe(client.connection.stream.authorized === true, 'DB TLS verification failed');
    redis = new Redis(env.REDIS_URL, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0, connectTimeout: 15000, commandTimeout: 15000, enableOfflineQueue: false });
    redis.on('error', () => {});
    await redis.connect();
    await redis.ping();
    const redisBefore = await redis.dbsize();
    const redisGroups = { bullmq: 0, gps: 0, cache: 0, rateLimit: 0, socketOrSession: 0, other: 0 };
    let redisCursor = '0';
    do {
      const [next, keys] = await redis.scan(redisCursor, 'COUNT', 500);
      redisCursor = next;
      for (const key of keys) {
        const group = /^(bull:|bullmq:)/i.test(key) ? 'bullmq' : /gps|location|linehaul\.trip/i.test(key) ? 'gps' : /cache|route:|tracking:|shipment:/i.test(key) ? 'cache' : /throttle|rate.?limit/i.test(key) ? 'rateLimit' : /socket|session/i.test(key) ? 'socketOrSession' : 'other';
        redisGroups[group]++;
      }
    } while (redisCursor !== '0');
    await client.query(execute ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTransaction = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    requireSafe(actual === decodeURIComponent(new URL(env.DIRECT_URL).pathname.slice(1)), 'Connected DB identity mismatch');
    const liveTables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map(r => r.tablename);
    const expectedTables = [...models, '_prisma_migrations'];
    const missingTables = expectedTables.filter(t => !liveTables.includes(t));
    const unexpectedTables = liveTables.filter(t => !expectedTables.includes(t) && !reviewedExtraTables.includes(t));
    if (missingTables.length || unexpectedTables.length) emit({ schemaDifference: { missingTables, unexpectedTables } });
    requireSafe(missingTables.length === 0 && unexpectedTables.length === 0, 'Unknown/missing tables; schema review required');
    const dataTables = models;
    if (execute) await client.query(`LOCK TABLE ${liveTables.map(tableSql).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const admins = (await client.query('SELECT * FROM public."User" WHERE role = $1', ['ADMIN'])).rows;
    emit({ admins: admins.map(({ id, email, status }) => ({ id, email, status })) });
    const admin = admins.find(a => a.id === target.keepAdminId && a.email.toLowerCase() === target.adminEmail?.toLowerCase());
    const fks = (await client.query(`SELECT child.relname AS child, parent.relname AS parent, a.attname AS column,
      cn.nspname AS child_schema, pn.nspname AS parent_schema
      FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid
      JOIN pg_namespace cn ON cn.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
      JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=f.conkey[1]
      WHERE f.contype='f' AND (cn.nspname='public' OR pn.nspname='public')`)).rows;
    requireSafe(fks.every(f => f.child_schema === 'public' && f.parent_schema === 'public' && models.includes(f.child) && models.includes(f.parent)), 'Unexpected cross-schema, sample-table or migration FK');
    const order = deletionOrder(dataTables, fks);
    const counts = async () => {
      const result = {};
      for (const table of dataTables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM ${tableSql(table)}`)).rows[0].n);
      return result;
    };
    const history = async () => fingerprint((await client.query('SELECT * FROM public._prisma_migrations ORDER BY id')).rows);
    const before = await counts();
    const migrationsBefore = await history();
    const migrationCount = Number((await client.query('SELECT count(*) AS n FROM public._prisma_migrations')).rows[0].n);
    const sampleBefore = liveTables.includes('playing_with_neon') ? Number((await client.query('SELECT count(*) AS n FROM public.playing_with_neon')).rows[0].n) : null;
    emit({ admin: admin ? { id: admin.id, email: admin.email, role: admin.role, status: admin.status } : null, adminEmailVerified: !!admin, adminCount: admins.length, before, redisBefore, redisGroups, migrationCount, migrationFingerprint: migrationsBefore, playingWithNeon: sampleBefore, deletionOrder: order, preserveAdminSessions: true });
    requireSafe(!!admin, 'Verified ADMIN email and ID not found; no account selected or deleted');
    requireSafe(admins.length === 1 || target.deleteOtherAdmins === true, 'Multiple ADMINs; explicit authorization required');
    requireSafe(admin.status === 'ACTIVE' && !!admin.passwordHash, 'ADMIN must be active with an existing password hash');
    if (execute) {
      requireSafe(Object.keys(before).length === Object.keys(target.expectedBefore).length && Object.entries(before).every(([table, count]) => target.expectedBefore[table] === count), 'Counts changed since reviewed dry run');
      requireSafe(migrationsBefore === target.migrationFingerprint, 'Migration history changed since reviewed dry run');
      requireSafe(sampleBefore === target.expectedSampleRows, 'Neon sample row count changed since reviewed dry run');
    }
    if (!execute) {
      await client.query('ROLLBACK'); inTransaction = false;
      emit({ result: 'DRY_RUN_ONLY', databaseChanged: false, redisChanged: false });
      return;
    }
    await client.query('UPDATE public."LineHaulTrip" SET "currentRouteId" = NULL WHERE "currentRouteId" IS NOT NULL');
    for (const table of order) {
      if (table === 'User') await client.query('DELETE FROM public."User" WHERE id <> $1', [admin.id]);
      else if (['AuthSession', 'PasswordResetToken'].includes(table)) await client.query(`DELETE FROM ${tableSql(table)} WHERE "userId" <> $1`, [admin.id]);
      else await client.query(`DELETE FROM ${tableSql(table)}`);
    }
    const after = await counts();
    requireSafe(after.User === 1 && dataTables.every(t => ['User', 'AuthSession', 'PasswordResetToken'].includes(t) || after[t] === 0), 'Post-delete counts failed');
    if (sampleBefore !== null) requireSafe((await client.query('SELECT count(*) AS n FROM public.playing_with_neon')).rows[0].n === String(sampleBefore), 'Neon sample rows changed; rolling back');
    requireSafe(fingerprint((await client.query('SELECT * FROM public."User"')).rows[0]) === fingerprint(admin), 'ADMIN row changed; rolling back');
    requireSafe(await history() === migrationsBefore, 'Migration history changed; rolling back');
    await client.query('COMMIT'); inTransaction = false; committed = true;
    emit({ databaseReset: 'PASS', after, clearedTables: order.filter(t => !['User', 'AuthSession', 'PasswordResetToken'].includes(t)), migrationsUnchanged: 'PASS', playingWithNeon: sampleBefore });
    // No FLUSHALL/FLUSHDB. Only scan the verified dedicated Redis DB. Bounded
    // passes fail honestly if live writers repopulate it; PostgreSQL is already committed.
    let deleted = 0;
    for (let pass = 0; pass < 3; pass++) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
        cursor = next;
        if (keys.length) deleted += await redis.unlink(...keys);
      } while (cursor !== '0');
      if (await redis.dbsize() === 0) break;
    }
    const remaining = await redis.dbsize();
    emit({ redisDeleted: deleted, redisRemaining: remaining, redisClear: remaining === 0 ? 'PASS' : 'FAIL' });
    requireSafe(remaining === 0, 'Redis repopulated; stop all staging writers');
    let health = 'FAIL', login = 'NOT_TESTED';
    const base = target.apiBase.replace(/\/$/, '');
    try {
      const response = await fetch(`${base}/health`, { redirect: 'error', signal: AbortSignal.timeout(60000) });
      const body = await response.json();
      const result = body.data ?? body;
      health = response.ok && result.status === 'ok' && result.checks?.database === 'up' && result.checks?.redis === 'up' ? 'PASS' : 'FAIL';
    } catch { /* Report unavailable without leaking fetch details. */ }
    if (process.env.RESET_ADMIN_PASSWORD) {
      login = 'FAIL';
      try {
        const response = await fetch(`${base}/auth/login`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: process.env.RESET_ADMIN_PASSWORD }) });
        const body = await response.json();
        const result = body.data ?? body;
        if (response.ok && result.user?.id === admin.id && result.user?.role === 'ADMIN' && result.accessToken) login = 'PASS';
      } catch { /* Never print response, cookies or credentials. */ }
    }
    const finalCounts = await counts();
    const finalAdmin = (await client.query('SELECT * FROM public."User"')).rows;
    requireSafe(finalCounts.User === 1 && dataTables.every(t => ['User', 'AuthSession', 'PasswordResetToken'].includes(t) || finalCounts[t] === 0), 'Business data reappeared after commit');
    requireSafe(finalAdmin.length === 1 && fingerprint(finalAdmin[0]) === fingerprint(admin), 'ADMIN changed after commit');
    const sampleAfter = sampleBefore === null ? null : Number((await client.query('SELECT count(*) AS n FROM public.playing_with_neon')).rows[0].n);
    requireSafe(sampleAfter === sampleBefore, 'Neon sample rows changed after commit');
    emit({ finalCounts, playingWithNeon: sampleAfter, migrationsUnchanged: await history() === migrationsBefore ? 'PASS' : 'FAIL', health, adminLogin: login, note: 'Login/health may create fresh disposable keys and an ADMIN session; old Redis keys were verified empty before these probes.' });
    if (health !== 'PASS' || login !== 'PASS' || await history() !== migrationsBefore) process.exitCode = 1;
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    emit({ result: 'FAIL', databaseCommitted: committed, reason: error instanceof ResetRefusal ? error.message : 'Operation failed; driver/config/HTTP details withheld to protect secrets' });
    process.exitCode = 1;
  } finally {
    redis?.disconnect();
    if (client) await client.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
