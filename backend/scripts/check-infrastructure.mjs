import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { Client } = pg;

async function checkPostgres(label, connectionString) {
  if (!connectionString) {
    throw new Error(`${label} is not configured`);
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1 AS connected');
    console.log(`${label}: connected`);
  } finally {
    await client.end();
  }
}

async function checkRedis(connectionString) {
  if (!connectionString) {
    throw new Error('REDIS_URL is not configured');
  }

  const client = new Redis(connectionString, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await client.connect();
    const response = await client.ping();

    if (response !== 'PONG') {
      throw new Error('Redis did not return PONG');
    }

    console.log('REDIS_URL: connected');
  } finally {
    await client.quit();
  }
}

await checkPostgres('DATABASE_URL', process.env.DATABASE_URL);
await checkPostgres('DIRECT_URL', process.env.DIRECT_URL);
await checkRedis(process.env.REDIS_URL);
