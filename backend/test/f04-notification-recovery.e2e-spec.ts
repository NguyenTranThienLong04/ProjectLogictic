import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { NotificationJobsService } from '../src/modules/notifications/notification-jobs.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { NotificationsGateway } from '../src/modules/notifications/notifications.gateway.js';
import type { EmailSender } from '../src/modules/notifications/email-sender.js';
import type { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(60_000);

describe('F04 PostgreSQL outbox + real BullMQ recovery', () => {
  const runId = randomUUID();
  const config = new ConfigService({
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: 'test',
    FRONTEND_URL: 'https://notification.example.test',
  });
  let prisma: PrismaService;
  let redis: Redis;
  let jobs: NotificationJobsService;
  let notifications: NotificationsService;
  let userId: string;
  const emit = jest.fn<NotificationsGateway['emitNotification']>();
  const send = jest.fn<EmailSender['send']>(() => Promise.resolve());
  const gateway = { emitNotification: emit } as unknown as NotificationsGateway;
  const sender = { enabled: true, send };
  const ids: string[] = [];
  const queues = () => jobs as unknown as { notificationQueue: Queue; emailQueue: Queue };
  const newJobs = (deliveryGateway = gateway) =>
    new NotificationJobsService(
      { isAvailable: () => true, getClient: () => redis } as unknown as RedisService,
      prisma,
      deliveryGateway,
      sender,
      config,
    );
  const waitFor = async (check: () => Promise<boolean>, timeout = 15_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Delivery condition was not met within ${timeout}ms`);
  };
  const done = (id: string) =>
    waitFor(
      async () =>
        (await prisma.notificationDelivery.count({
          where: { notificationId: id, completedAt: { not: null } },
        })) === 2,
    );
  const input = (name: string) => ({
    userId,
    eventKey: `f04:${runId}:${name}`,
    type: 'DELIVERED',
    title: `F04 ${name}`,
    message: 'Recovery integration notification',
  });
  const create = async (name: string) => {
    const [notification] = await prisma.$transaction((tx) =>
      notifications.createIdempotent(tx, [input(name)]),
    );
    ids.push(notification.id);
    return notification;
  };
  const due = (id: string) =>
    prisma.notificationDelivery.updateMany({
      where: { notificationId: id, completedAt: null },
      data: { nextAttemptAt: new Date(0) },
    });

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    const testDatabase =
      /^\/p0_regression_\d+$/.test(database.pathname) ||
      (process.env.CI === 'true' && database.pathname === '/i1_e2e');
    if (
      !['127.0.0.1', 'localhost'].includes(database.hostname) ||
      database.port !== '55432' ||
      !testDatabase
    ) {
      throw new Error('F04 requires an explicitly configured disposable local regression database');
    }
    const redisUrl = new URL(process.env.REDIS_URL!);
    if (!['127.0.0.1', 'localhost'].includes(redisUrl.hostname))
      throw new Error('Local Redis required');
    prisma = new PrismaService(config);
    await prisma.$connect();
    redis = new Redis(redisUrl.toString(), { lazyConnect: true });
    await redis.connect();
    userId = (
      await prisma.user.create({
        data: {
          email: `f04-${runId}@example.test`,
          fullName: 'F04 recovery',
          passwordHash: 'test-no-login',
          role: UserRole.CUSTOMER,
        },
      })
    ).id;
    jobs = newJobs();
    notifications = new NotificationsService(prisma, gateway, {} as never, jobs);
    await jobs.onModuleInit();
  });

  afterAll(async () => {
    await jobs?.onModuleDestroy();
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await redis?.quit();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await queues().notificationQueue.resume();
    await queues().emailQueue.resume();
  });

  it('A: commits notification + both intents atomically and delivers both channels', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await notifications.createIdempotent(tx, [input('rollback')]);
        throw new Error('rollback transaction');
      }),
    ).rejects.toThrow('rollback transaction');
    expect(
      await prisma.notification.count({ where: { eventKey: input('rollback').eventKey } }),
    ).toBe(0);
    const notification = await create('success');
    expect(
      await prisma.notificationDelivery.count({ where: { notificationId: notification.id } }),
    ).toBe(2);
    await jobs.enqueueNotifications([notification]);
    await done(notification.id);
    expect(emit.mock.calls.filter(([row]) => row.id === notification.id)).toHaveLength(1);
    expect(send.mock.calls.filter(([mail]) => mail.subject === notification.title)).toHaveLength(1);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).emailSentAt,
    ).not.toBeNull();
    expect(
      await queues().notificationQueue.getJob(`notification-${notification.id}`),
    ).toBeDefined();
    expect(await queues().emailQueue.getJob(`email-${notification.id}`)).toBeDefined();
  });

  it('B/C: records enqueue failure, leaves in-app readable, and recovers after service restart', async () => {
    await queues().notificationQueue.pause();
    await queues().emailQueue.pause();
    const notification = await create('redis-failure');
    const fail = jest
      .spyOn(queues().notificationQueue, 'add')
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    try {
      await jobs.enqueueNotifications([notification]);
      const state = await prisma.notificationDelivery.findUniqueOrThrow({
        where: {
          notificationId_channel: { notificationId: notification.id, channel: 'REALTIME' },
        },
      });
      expect(state).toMatchObject({
        completedAt: null,
        enqueuedAt: null,
        enqueueAttempts: 1,
        lastError: 'Redis unavailable',
      });
      expect(state.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect((await notifications.list(userId, 1, 50, true)).items.map(({ id }) => id)).toContain(
        notification.id,
      );
    } finally {
      fail.mockRestore();
    }
    await jobs.onModuleDestroy();
    await due(notification.id); // Advance only this fixture past its persisted backoff.
    jobs = newJobs();
    await jobs.onModuleInit();
    await queues().notificationQueue.resume();
    await queues().emailQueue.resume();
    await done(notification.id);
    expect(emit.mock.calls.filter(([row]) => row.id === notification.id)).toHaveLength(1);
    expect(send.mock.calls.filter(([mail]) => mail.subject === notification.title)).toHaveLength(1);
  });

  it('C: startup recovers a committed notification with no post-commit publish call', async () => {
    await jobs.onModuleDestroy();
    const notification = await create('commit-without-publish');
    expect(
      await prisma.notificationDelivery.count({
        where: { notificationId: notification.id, enqueuedAt: null },
      }),
    ).toBe(2);
    jobs = newJobs();
    await jobs.onModuleInit();
    await done(notification.id);
  });

  it('D: repeated producers/reconcilers keep one durable intent and one queue job per channel', async () => {
    await queues().notificationQueue.pause();
    await queues().emailQueue.pause();
    const notification = await create('deduplication');
    const retried = await create('deduplication');
    expect(retried.id).toBe(notification.id);
    const concurrent = newJobs();
    await concurrent.onModuleInit();
    try {
      for (let n = 0; n < 4; n++) {
        await due(notification.id);
        await Promise.all([
          jobs.enqueueNotifications([notification]),
          concurrent.reconcile([notification.id]),
        ]);
      }
      expect(
        await prisma.notificationDelivery.count({ where: { notificationId: notification.id } }),
      ).toBe(2);
      for (const [queue, prefix] of [
        [queues().notificationQueue, 'notification'],
        [queues().emailQueue, 'email'],
      ] as const) {
        expect(
          (await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'])).filter(
            (job) => job.id === `${prefix}-${notification.id}`,
          ),
        ).toHaveLength(1);
      }
      await queues().notificationQueue.resume();
      await queues().emailQueue.resume();
      await done(notification.id);
      await waitFor(
        async () =>
          (await (await queues().notificationQueue.getJob(
            `notification-${notification.id}`,
          ))!.getState()) === 'completed' &&
          (await (await queues().emailQueue.getJob(`email-${notification.id}`))!.getState()) ===
            'completed',
      );
      // Even a retained/completed job replay checks PostgreSQL before side effects.
      await (await queues().notificationQueue.getJob(`notification-${notification.id}`))!.retry(
        'completed',
      );
      await (await queues().emailQueue.getJob(`email-${notification.id}`))!.retry('completed');
      await waitFor(
        async () =>
          (await (await queues().emailQueue.getJob(`email-${notification.id}`))!.getState()) ===
          'completed',
      );
      expect(emit.mock.calls.filter(([row]) => row.id === notification.id)).toHaveLength(1);
      expect(send.mock.calls.filter(([mail]) => mail.subject === notification.title)).toHaveLength(
        1,
      );
    } finally {
      await concurrent.onModuleDestroy();
    }
  });

  it.each(['reconcile', 'restart'] as const)(
    'B/C/D/E: real gateway failure stays pending through BullMQ exhaustion and %s recovers it',
    async (recovery) => {
      await jobs.onModuleDestroy();
      const realGateway = new NotificationsGateway({} as never, config, prisma);
      const fetchSockets = jest.fn<() => Promise<never[]>>(() =>
        Promise.reject(new Error('temporary socket adapter failure')),
      );
      (realGateway as unknown as { server: unknown }).server = { in: () => ({ fetchSockets }) };
      jobs = newJobs(realGateway);
      await jobs.onModuleInit();
      clearInterval(
        (jobs as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      );
      const notification = await create(`gateway-failure-${recovery}`);
      await jobs.enqueueNotifications([notification]);
      const jobId = `notification-${notification.id}`;
      await waitFor(
        async () =>
          (await (await queues().notificationQueue.getJob(jobId))?.getState()) === 'failed',
        30_000,
      );
      const failedJob = await queues().notificationQueue.getJob(jobId);
      expect(failedJob?.attemptsMade).toBe(5);
      expect(failedJob?.opts).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      });
      const key = {
        notificationId_channel: { notificationId: notification.id, channel: 'REALTIME' as const },
      };
      const failed = await prisma.notificationDelivery.findUniqueOrThrow({ where: key });
      expect(failed).toMatchObject({
        completedAt: null,
        lastError: 'temporary socket adapter failure',
        enqueueAttempts: 1,
      });
      expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(notification.createdAt.getTime());
      expect(
        (await notifications.list(userId, 1, 50, true)).items.some(
          ({ id }) => id === notification.id,
        ),
      ).toBe(true);
      expect((await create(`gateway-failure-${recovery}`)).id).toBe(notification.id);
      expect(
        await prisma.notificationDelivery.count({ where: { notificationId: notification.id } }),
      ).toBe(2);
      fetchSockets.mockResolvedValue([]); // No online clients is an acknowledged attempt, not an infrastructure failure.
      await due(notification.id);
      if (recovery === 'restart') {
        await jobs.onModuleDestroy();
        jobs = newJobs(realGateway);
        await jobs.onModuleInit();
      } else await jobs.reconcile([notification.id]);
      await done(notification.id);
      expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: key })).toMatchObject({
        lastError: null,
        enqueueAttempts: 2,
      });
      expect(fetchSockets).toHaveBeenCalledTimes(6);
      await jobs.processNotification(notification.id);
      await jobs.reconcile([notification.id]);
      expect(fetchSockets).toHaveBeenCalledTimes(6);
      await jobs.onModuleDestroy();
      jobs = newJobs();
      await jobs.onModuleInit();
    },
  );

  it('E: SMTP worker failure uses the original BullMQ exponential retry', async () => {
    const notification = await create('smtp-retry');
    send.mockRejectedValueOnce(new Error('temporary SMTP failure'));
    await jobs.enqueueNotifications([notification]);
    await done(notification.id);
    const job = await queues().emailQueue.getJob(`email-${notification.id}`);
    expect(job?.opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } }))
        .emailAttempts,
    ).toBe(2);
    expect(send.mock.calls.filter(([mail]) => mail.subject === notification.title)).toHaveLength(2);
    expect(emit.mock.calls.filter(([row]) => row.id === notification.id)).toHaveLength(1);
    expect(
      await prisma.notificationDelivery.count({
        where: { notificationId: notification.id, enqueueAttempts: 1 },
      }),
    ).toBe(2);
  });

  it('F: completion does not change in-app unread state or ownership', async () => {
    const id = ids[0];
    await expect(notifications.markRead(randomUUID(), id)).rejects.toMatchObject({ status: 404 });
    const before = await notifications.list(userId, 1, 50, true);
    expect(before.items.some((row) => row.id === id)).toBe(true);
    expect(before.items[0]).not.toHaveProperty('deliveries');
    await notifications.markRead(userId, id);
    await notifications.markRead(userId, id);
    const after = await notifications.list(userId, 1, 50, true);
    expect(after.unreadCount).toBe(before.unreadCount - 1);
  });

  it('recovers a lost Redis job from an acknowledged but unfinished PostgreSQL intent', async () => {
    await queues().notificationQueue.pause();
    await queues().emailQueue.pause();
    const notification = await create('lost-job');
    await jobs.enqueueNotifications([notification]);
    await (await queues().emailQueue.getJob(`email-${notification.id}`))!.remove();
    await due(notification.id);
    await jobs.reconcile([notification.id]);
    expect(await queues().emailQueue.getJob(`email-${notification.id}`)).toBeDefined();
    await queues().notificationQueue.resume();
    await queues().emailQueue.resume();
    await done(notification.id);
    expect(send.mock.calls.filter(([mail]) => mail.subject === notification.title)).toHaveLength(1);
  });

  it('bounds each scan to 50 intents and caps persisted backoff at five minutes', async () => {
    // Control the scheduler while asserting a single scan; real PostgreSQL/Redis remain active.
    clearInterval(
      (jobs as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
        .reconciliationTimer,
    );
    await queues().notificationQueue.pause();
    await queues().emailQueue.pause();
    const batch = await prisma.$transaction((tx) =>
      notifications.createIdempotent(
        tx,
        Array.from({ length: 30 }, (_, index) => input(`batch-${index}`)),
      ),
    );
    ids.push(...batch.map(({ id }) => id));
    const scope = { notificationId: { in: batch.map(({ id }) => id) } };
    await jobs.enqueueNotifications(batch);
    expect(
      await prisma.notificationDelivery.count({ where: { ...scope, enqueueAttempts: 1 } }),
    ).toBe(50);
    expect(
      await prisma.notificationDelivery.count({ where: { ...scope, enqueueAttempts: 0 } }),
    ).toBe(10);
    const example = batch[0].id;
    await prisma.notificationDelivery.updateMany({
      where: { notificationId: example },
      data: { enqueueAttempts: 40, nextAttemptAt: new Date(0) },
    });
    await jobs.reconcile([example]);
    const attempts = await prisma.notificationDelivery.findMany({
      where: { notificationId: example },
    });
    for (const attempt of attempts) {
      expect(attempt.enqueueAttempts).toBe(41);
      expect(attempt.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(295_000);
      expect(attempt.nextAttemptAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    }
    await jobs.reconcile(batch.map(({ id }) => id));
    await queues().notificationQueue.resume();
    await queues().emailQueue.resume();
    await Promise.all(batch.map(({ id }) => done(id)));
  });
});
