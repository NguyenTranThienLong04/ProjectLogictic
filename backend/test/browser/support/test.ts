import { test as base } from '@playwright/test';
import { Redis } from 'ioredis';

export * from '@playwright/test';

export async function resetBrowserAuditRateLimits(baseURL: string | undefined): Promise<void> {
  if (process.env.I1_AUDIT !== 'true') return;
  if (new URL(baseURL ?? '').hostname !== 'localhost')
    throw new Error('Audit browser must use localhost');
  const url = new URL(process.env.REDIS_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '56379' || url.pathname !== '/1') {
    throw new Error('Browser audit requires dedicated local Redis port 56379 DB 1');
  }
  const redis = new Redis(url.toString(), { maxRetriesPerRequest: 1 });
  try {
    const keys = await redis.keys('rate-limit:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

export const test = base.extend<{ auditIsolation: void }>({
  auditIsolation: [
    async ({ baseURL }, use) => {
      await resetBrowserAuditRateLimits(baseURL);
      await use();
    },
    { auto: true },
  ],
});
