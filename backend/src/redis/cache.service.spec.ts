import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service.js';
import { CacheService } from './cache.service.js';
import type { RedisService } from './redis.service.js';

function serviceWith(
  client: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>;
    del: (...keys: string[]) => Promise<unknown>;
  },
  prisma: PrismaService = {} as PrismaService,
) {
  const redis = { getClient: jest.fn(() => client) } as unknown as RedisService;
  const config = {
    getOrThrow: jest.fn((key: string) => (key === 'CACHE_TRACKING_TTL_SECONDS' ? 60 : 90)),
  } as unknown as ConfigService;
  return new CacheService(redis, prisma, config);
}

describe('CacheService', () => {
  it('degrades a Redis failure to a cache miss', async () => {
    const cache = serviceWith({
      get: jest.fn(() => Promise.reject(new Error('Redis unavailable'))),
      set: jest.fn(() => Promise.resolve('OK')),
      del: jest.fn(() => Promise.resolve(0)),
    });

    await expect(cache.get('tracking:SHP-1')).resolves.toBeNull();
  });

  it('invalidates both documented shipment cache keys', async () => {
    const del = jest.fn<(...keys: string[]) => Promise<number>>(() => Promise.resolve(2));
    const cache = serviceWith({
      get: jest.fn(() => Promise.resolve(null)),
      set: jest.fn(() => Promise.resolve('OK')),
      del,
    });

    await cache.invalidateShipment('shipment-id', 'shp-1');

    expect(del).toHaveBeenCalledWith('shipment:shipment-id:summary', 'tracking:SHP-1');
  });
});
