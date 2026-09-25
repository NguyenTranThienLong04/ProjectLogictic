import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { UserRole, type Notification } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { RedisService } from '../../redis/redis.service.js';
import type { EmailSender } from './email-sender.js';
import { NotificationJobsService } from './notification-jobs.service.js';
import type { NotificationsGateway } from './notifications.gateway.js';

const notificationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function configuration(): ConfigService {
  const values: Record<string, string> = {
    FRONTEND_URL: 'https://logistics.example.test',
    PASSWORD_RESET_URL: 'https://logistics.example.test/reset-password',
    PASSWORD_RESET_TTL_MINUTES: '15',
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function notification(): Notification & { user: { email: string; role: UserRole } } {
  return {
    id: notificationId,
    userId,
    eventKey: 'shipment:one:delivered',
    type: 'DELIVERED',
    title: 'Delivered',
    message: 'Shipment delivered',
    data: null,
    readAt: null,
    emailSentAt: null,
    emailMessageId: null,
    emailAttempts: 0,
    emailLastError: null,
    createdAt: new Date('2026-08-25T12:00:00.000Z'),
    user: { email: 'customer@example.test', role: UserRole.CUSTOMER },
  };
}

describe('NotificationJobsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not create BullMQ connections when Redis startup is unavailable', async () => {
    const getClient = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const jobs = new NotificationJobsService(
      { isAvailable: jest.fn(() => false), getClient } as unknown as RedisService,
      {} as PrismaService,
      {} as NotificationsGateway,
      {} as EmailSender,
      configuration(),
    );

    await jobs.onModuleInit();
    await jobs.onModuleDestroy();

    expect(getClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('BullMQ disabled because Redis is unavailable');
  });

  it('disconnects producer clients when Redis disappears during BullMQ startup', async () => {
    const disconnect = jest.fn();
    const on = jest.fn();
    const connections = [
      { connect: jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))), disconnect, on },
      { connect: jest.fn(() => Promise.resolve()), disconnect, on },
    ];
    const duplicate = jest.fn(() => connections.shift());
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const jobs = new NotificationJobsService(
      {
        isAvailable: jest.fn(() => true),
        getClient: jest.fn(() => ({ duplicate })),
      } as unknown as RedisService,
      {} as PrismaService,
      {} as NotificationsGateway,
      {} as EmailSender,
      configuration(),
    );

    await jobs.onModuleInit();
    await jobs.onModuleDestroy();

    expect(duplicate).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'BullMQ disabled because Redis became unavailable: BullMQ Redis producers startup connection or readiness failed',
    );
  });

  it('fails closed if Redis disappears during production queue startup', async () => {
    const disconnect = jest.fn();
    const duplicate = jest.fn(() => ({
      connect: jest.fn(() => Promise.reject(new Error('private connection details'))),
      disconnect,
      on: jest.fn(),
    }));
    const jobs = new NotificationJobsService(
      { isAvailable: () => true, getClient: () => ({ duplicate }) } as unknown as RedisService,
      {} as PrismaService,
      {} as NotificationsGateway,
      {} as EmailSender,
      { getOrThrow: () => 'production' } as unknown as ConfigService,
    );
    await expect(jobs.onModuleInit()).rejects.toThrow(
      'BullMQ Redis producers startup connection or readiness failed',
    );
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('uses the persisted email marker to make a retry idempotent', async () => {
    const current = notification();
    const findUnique = jest.fn(() => Promise.resolve(current));
    const updateMany = jest.fn(
      (args: {
        data: {
          emailAttempts?: { increment: number };
          emailSentAt?: Date;
          emailMessageId?: string;
        };
      }) => {
        if (args.data.emailAttempts) current.emailAttempts += args.data.emailAttempts.increment;
        if (args.data.emailSentAt) current.emailSentAt = args.data.emailSentAt;
        if (args.data.emailMessageId) current.emailMessageId = args.data.emailMessageId;
        return Promise.resolve({ count: 1 });
      },
    );
    const prisma = {
      notification: { findUnique, updateMany },
    } as unknown as PrismaService;
    const send = jest.fn(() => Promise.resolve());
    const jobs = new NotificationJobsService(
      {} as RedisService,
      prisma,
      {} as NotificationsGateway,
      { enabled: true, send },
      configuration(),
    );

    await jobs.processEmail(notificationId);
    await jobs.processEmail(notificationId);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.test',
        messageId: `<notification-${notificationId}@logistics.example.test>`,
      }),
    );
    expect(current.emailAttempts).toBe(1);
  });

  it('isolates a BullMQ enqueue failure from the committed notification state', async () => {
    const jobs = new NotificationJobsService(
      {} as RedisService,
      {} as PrismaService,
      {} as NotificationsGateway,
      {} as EmailSender,
      configuration(),
    );
    const addBulk = jest.fn(() => Promise.reject(new Error('Redis unavailable')));
    (
      jobs as unknown as {
        notificationQueue: { addBulk: typeof addBulk };
      }
    ).notificationQueue = { addBulk };

    await expect(jobs.enqueueNotifications([notification()])).resolves.toBeUndefined();
    expect(addBulk).toHaveBeenCalledTimes(1);
  });

  it('gracefully skips SMTP enqueue when delivery is disabled', async () => {
    const current = notification();
    const findUnique = jest.fn(() => Promise.resolve(current));
    const emitNotification = jest.fn();
    const gateway = { emitNotification } as unknown as NotificationsGateway;
    const add = jest.fn(() => Promise.resolve());
    const send = jest.fn(() => Promise.resolve());
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const jobs = new NotificationJobsService(
      {} as RedisService,
      { notification: { findUnique } } as unknown as PrismaService,
      gateway,
      { enabled: false, send },
      configuration(),
    );
    (
      jobs as unknown as {
        emailQueue: { add: typeof add };
      }
    ).emailQueue = { add };

    await expect(jobs.processNotification(notificationId)).resolves.toBeUndefined();

    expect(emitNotification).toHaveBeenCalledWith(current);
    expect(add).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`SMTP disabled, skipped email notification ${notificationId}`);
  });

  it('gracefully completes a stale email job when SMTP is disabled', async () => {
    const findUnique = jest.fn();
    const send = jest.fn(() => Promise.resolve());
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const jobs = new NotificationJobsService(
      {} as RedisService,
      { notification: { findUnique } } as unknown as PrismaService,
      {} as NotificationsGateway,
      { enabled: false, send },
      configuration(),
    );

    await expect(jobs.processEmail(notificationId)).resolves.toBeUndefined();

    expect(findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`SMTP disabled, skipped email notification ${notificationId}`);
  });

  it('sends password reset delivery through the retryable email worker boundary', async () => {
    const send = jest.fn<EmailSender['send']>(() => Promise.resolve());
    const jobs = new NotificationJobsService(
      {} as RedisService,
      {} as PrismaService,
      {} as NotificationsGateway,
      { enabled: true, send },
      configuration(),
    );

    await jobs.processPasswordReset({
      kind: 'password-reset',
      requestId: '33333333-3333-4333-8333-333333333333',
      email: 'customer@example.test',
      token: 'reset-token-value',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const message = send.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: 'customer@example.test',
      messageId: '<password-reset-33333333-3333-4333-8333-333333333333@logistics.example.test>',
    });
    expect(message?.text).toContain(
      'https://logistics.example.test/reset-password?token=reset-token-value',
    );
  });
});
