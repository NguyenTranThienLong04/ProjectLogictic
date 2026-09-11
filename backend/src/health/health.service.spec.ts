import { ServiceUnavailableException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const createService = (databaseResult: Promise<unknown>, redisResult: Promise<string>) => {
    const prisma = {
      $queryRaw: jest.fn(() => databaseResult),
    } as unknown as PrismaService;
    const redis = {
      getClient: jest.fn(() => ({ ping: jest.fn(() => redisResult) })),
    } as unknown as RedisService;

    return new HealthService(prisma, redis);
  };

  it('reports all dependencies as ready', async () => {
    const service = createService(Promise.resolve([{ '?column?': 1 }]), Promise.resolve('PONG'));

    await expect(service.checkReadiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports Redis degradation without making the API unready', async () => {
    const service = createService(
      Promise.resolve([{ '?column?': 1 }]),
      Promise.reject(new Error()),
    );

    await expect(service.checkReadiness()).resolves.toMatchObject({
      status: 'degraded',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('fails readiness when PostgreSQL is unavailable', async () => {
    const service = createService(
      Promise.reject(new Error('connection failed')),
      Promise.resolve('PONG'),
    );

    await expect(service.checkReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
