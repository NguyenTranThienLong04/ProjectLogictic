import { startupStep } from './startup.js';

describe('startupStep', () => {
  it('returns a ready dependency', async () => {
    await expect(startupStep('Redis', () => Promise.resolve('PONG'))).resolves.toBe('PONG');
  });

  it('bounds a connection that never becomes ready', async () => {
    await expect(
      startupStep('BullMQ Redis producers', () => new Promise(() => {}), 10),
    ).rejects.toThrow('BullMQ Redis producers startup timeout');
  });

  it('identifies the dependency without exposing connection secrets', async () => {
    await expect(
      startupStep('Database', () =>
        Promise.reject(new Error('postgresql://user:private-password@host/db?token=private-token')),
      ),
    ).rejects.toThrow('Database startup connection or readiness failed');
  });
});
