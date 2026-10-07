// Real Prisma deploy + historical delivery regression, on a NEW empty local database only.
// Run after backend build, with AUDIT_DATABASE_URL. Never resets, seeds or repairs a ledger.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/database/prisma.service.js';
import { NotificationsService } from '../dist/modules/notifications/notifications.service.js';
import { NotificationJobsService } from '../dist/modules/notifications/notification-jobs.service.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const url = new URL(process.env.AUDIT_DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.equal(url.port, '55432');
assert.match(url.pathname, /^\/(p0_regression|release_cutover)_\d+$/);
const original = '20261007120000_notification_delivery_outbox';
const correction = '20261007180000_notification_historical_email_cutover';
const migrations = path.join(root, 'backend/prisma/migrations');
const originalSql = await readFile(path.join(migrations, original, 'migration.sql'));
assert.equal(createHash('sha256').update(originalSql).digest('hex'),
  '63958af5056d890960942af346034e7729e25ce0546ec5b58c3bb78a2d21f196', 'Applied outbox migration must not be rewritten');

const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
const config = new ConfigService({ DATABASE_URL: url.toString(), NODE_ENV: 'test', FRONTEND_URL: 'https://cutover.example.test' });
const prisma = new PrismaService(config);
await client.connect();
const artifacts = await mkdtemp(path.join(tmpdir(), 'notification-cutover-'));
try {
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(tables.rowCount, 0, 'Use a new empty disposable database; never reset an existing database');
  const copiedMigrations = path.join(artifacts, 'migrations');
  await mkdir(copiedMigrations);
  await copyFile(path.join(migrations, 'migration_lock.toml'), path.join(copiedMigrations, 'migration_lock.toml'));
  const names = (await readdir(migrations, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  assert.equal(names.at(-1), correction);
  async function copyMigration(name) {
    await mkdir(path.join(copiedMigrations, name));
    await copyFile(path.join(migrations, name, 'migration.sql'), path.join(copiedMigrations, name, 'migration.sql'));
  }
  for (const name of names.filter(name => name < original)) await copyMigration(name);
  const temporaryConfig = path.join(artifacts, 'prisma.config.mjs');
  await writeFile(temporaryConfig, `export default ${JSON.stringify({
    schema: path.join(root, 'backend/prisma/schema.prisma'), migrations: { path: copiedMigrations },
  }).slice(0, -1)}, datasource: { url: process.env.DIRECT_URL }};\n`);
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), SHADOW_DATABASE_URL: '' };
  function deploy(label, configPath) {
    const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', configPath], {
      cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, `Prisma deploy failed: ${label}`);
    console.log(`PASS ${label}`);
  }
  deploy('pre-outbox baseline', temporaryConfig);
  await prisma.$connect();
  const user = await prisma.user.create({ data: {
    email: `cutover-${randomUUID()}@example.test`, fullName: 'Cutover test only', passwordHash: 'no-login', role: 'CUSTOMER',
  } });
  const historicalSentAt = new Date('2026-10-01T00:00:00Z');
  const historical = Array.from({ length: 121 }, (_, i) => ({
    id: randomUUID(), userId: user.id, eventKey: `legacy-${i}`, type: 'DELIVERED', title: `Legacy ${i}`,
    message: 'Historical test fixture', emailSentAt: i === 120 ? historicalSentAt : null,
  }));
  await prisma.notification.createMany({ data: historical });
  const before = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });
  await copyMigration(original);
  deploy('original outbox migration unchanged', temporaryConfig);
  assert.equal(await prisma.notificationDelivery.count({ where: { channel: 'EMAIL', completedAt: null } }), 120);

  let sends = 0, emits = 0;
  const gateway = { emitNotification: async () => { emits++; } };
  const sender = { enabled: true, send: async () => { sends++; } };
  const jobs = new NotificationJobsService({}, prisma, gateway, sender, config);
  const notifications = new NotificationsService(prisma, gateway, {}, jobs);
  const createNew = async (key) => (await prisma.$transaction(tx => notifications.createIdempotent(tx, [{
    userId: user.id, eventKey: key, type: 'DELIVERED', title: key, message: 'Post-cutover test fixture',
  }])))[0];
  // Covers a local installation where F04 has already been applied: do not suppress its new intents.
  const existingNew = await createNew('new-backend-existing');
  const finalConfig = path.join(root, 'backend/prisma.config.ts');
  deploy('append historical-email correction', finalConfig);
  deploy('repeat deploy without rewriting history', finalConfig);
  const ledger = await client.query('SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [original]);
  assert.equal(ledger.rows[0].checksum, createHash('sha256').update(originalSql).digest('hex'));
  const after = await prisma.notification.findMany({ where: { id: { in: historical.map(n => n.id) } }, orderBy: { id: 'asc' } });
  assert.deepEqual(after, before, 'Notification content/read/email markers must not be rewritten');
  assert.equal(await prisma.notificationDelivery.count({ where: { channel: 'EMAIL', skippedReason: 'LEGACY_EMAIL', completedAt: { not: null } } }), 120);
  const sent = await prisma.notificationDelivery.findUniqueOrThrow({ where: { notificationId_channel: { notificationId: historical[120].id, channel: 'EMAIL' } } });
  assert.equal(sent.completedAt.toISOString(), historicalSentAt.toISOString());
  assert.equal(sent.skippedReason, null);
  for (const row of historical) { await jobs.processEmail(row.id); await jobs.processNotification(row.id); }
  assert.equal(sends, 0, 'Historical email must not send even when SMTP is enabled');
  assert.equal(emits, 0);
  const fresh = await createNew('new-backend-after-cutover');
  for (const row of [existingNew, fresh]) {
    assert.equal(await prisma.notificationDelivery.count({ where: { notificationId: row.id, completedAt: null } }), 2);
    assert.equal((await createNew(row.eventKey)).id, row.id);
    await jobs.processEmail(row.id); await jobs.processNotification(row.id);
    await jobs.processEmail(row.id); await jobs.processNotification(row.id);
    assert.equal(await prisma.notificationDelivery.count({ where: { notificationId: row.id, completedAt: { not: null } } }), 2);
  }
  assert.equal(sends, 2); assert.equal(emits, 2);
  console.log(JSON.stringify({ result: 'PASS', historicalSkipped: 120, historicalSentPreserved: 1,
    historicalSends: 0, postCutoverNotifications: 2, postCutoverSends: sends, originalMigrationUnchanged: true,
    database: url.pathname.slice(1), migrationCopyDirectory: artifacts }));
} finally { await prisma.$disconnect(); await client.end(); }
