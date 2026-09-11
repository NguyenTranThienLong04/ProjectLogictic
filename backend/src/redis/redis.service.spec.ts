import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { Redis } from 'ioredis';
import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('disconnects after an unavailable startup so reconnect timers cannot keep tests alive', async () => {
    const connect = jest
      .spyOn(Redis.prototype, 'connect')
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    const disconnect = jest.spyOn(Redis.prototype, 'disconnect');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'test' : 'redis://127.0.0.1:6379',
      ),
    } as unknown as ConfigService;
    const service = new RedisService(config);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.onModuleDestroy()).toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(false);
    expect(service.isAvailable()).toBe(false);
    expect(service.getClient().status).toBe('end');
  });

  it('fails fast against an actually unavailable local Redis endpoint', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      getOrThrow: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : 'redis://127.0.0.1:1')),
    } as unknown as ConfigService;
    const service = new RedisService(config);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(service.isAvailable()).toBe(false);
    expect(service.getClient().status).toBe('end');
    service.onModuleDestroy();
  });

  it('fails production startup instead of permanently disabling Redis-backed services', async () => {
    jest.spyOn(Redis.prototype, 'connect').mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : 'rediss://cache.example.test:6379',
      ),
    } as unknown as ConfigService;
    const service = new RedisService(config);

    await expect(service.onModuleInit()).rejects.toThrow(
      'Redis is required but unavailable during production startup',
    );
    expect(service.getClient().status).toBe('end');
  });
});
