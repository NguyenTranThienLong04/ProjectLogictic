import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const migrationUrl = process.env.DIRECT_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL || undefined;
const isMigrationCommand = process.argv.includes('migrate');

if (isMigrationCommand && !migrationUrl) {
  throw new Error('DIRECT_URL is required for Prisma migration commands');
}

if (shadowDatabaseUrl) {
  const shadow = new URL(shadowDatabaseUrl);
  if (!['postgres:', 'postgresql:'].includes(shadow.protocol)) {
    throw new Error('SHADOW_DATABASE_URL must be a PostgreSQL URL');
  }
  for (const value of [migrationUrl, process.env.DATABASE_URL]) {
    if (!value) continue;
    const database = new URL(value);
    // Same database through pooled/direct Neon hosts is still the same target.
    const host = (url: URL) => url.hostname.replace('-pooler.', '.');
    if (host(shadow) === host(database) && shadow.pathname === database.pathname) {
      throw new Error('SHADOW_DATABASE_URL must not target the runtime or migration database');
    }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['public.playing_with_neon'],
  },
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl, shadowDatabaseUrl } } : {}),
});
