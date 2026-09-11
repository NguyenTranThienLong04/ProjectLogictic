import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service.js';
import { redactSensitiveText } from '../common/logging/structured-log.js';

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local blockedHits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local blockedExpire = redis.call('PTTL', KEYS[1])
  return {blockedHits, blockedExpire, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local expire = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  local duration = tonumber(ARGV[3])
  if duration <= 0 then duration = tonumber(ARGV[1]) end
  redis.call('SET', KEYS[2], '1', 'PX', duration, 'NX')
  return {hits, expire, 1, redis.call('PTTL', KEYS[2])}
end
return {hits, expire, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    try {
      const baseKey = `rate-limit:${throttlerName}:${key}`;
      const result = await this.redis
        .getClient()
        .eval(
          INCREMENT_SCRIPT,
          2,
          `${baseKey}:hits`,
          `${baseKey}:blocked`,
          ttl,
          limit,
          blockDuration,
        );
      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = this.result(result);
      return {
        totalHits,
        timeToExpire: Math.max(0, Math.ceil(timeToExpire / 1_000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(timeToBlockExpire / 1_000)),
      };
    } catch (error) {
      this.logger.warn(
        `Redis rate limiting unavailable; using local fallback: ${this.message(error)}`,
      );
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }

  private result(value: unknown): [number, number, number, number] {
    if (!Array.isArray(value) || value.length !== 4) throw new Error('Invalid Redis rate result');
    return value.map((item) => Number(item)) as [number, number, number, number];
  }

  private message(error: unknown): string {
    return error instanceof Error ? redactSensitiveText(error.message) : 'unknown Redis error';
  }
}
