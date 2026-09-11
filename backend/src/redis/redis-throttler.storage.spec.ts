import { jest } from '@jest/globals';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage response headers', () => {
  it('converts Redis millisecond TTLs to the seconds required by Nest throttler', async () => {
    const evalScript = jest.fn(() => Promise.resolve([101, 59_501, 1, 60_000]));
    const storage = new RedisThrottlerStorage({
      getClient: () => ({ eval: evalScript }),
    } as never);
    await expect(storage.increment('client', 60_000, 100, 60_000, 'default')).resolves.toEqual({
      totalHits: 101,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    storage.onApplicationShutdown();
  });
});
