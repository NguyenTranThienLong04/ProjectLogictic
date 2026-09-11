import { jest } from '@jest/globals';
import type { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  it('marks only the authenticated user notifications read in one conditional update', async () => {
    const updateMany = jest.fn<
      (args: { where: { userId: string; readAt: null }; data: { readAt: Date } }) => Promise<{
        count: number;
      }>
    >(() => Promise.resolve({ count: 3 }));
    const prisma = { notification: { updateMany } } as unknown as PrismaService;
    const service = new NotificationsService(prisma, {} as never, {} as never, {} as never);

    await expect(service.markAllRead('user-id')).resolves.toEqual({
      markedCount: 3,
      unreadCount: 0,
    });
    const update = updateMany.mock.calls[0]?.[0];
    expect(update?.where).toEqual({ userId: 'user-id', readAt: null });
    expect(update?.data.readAt).toBeInstanceOf(Date);
  });
});
