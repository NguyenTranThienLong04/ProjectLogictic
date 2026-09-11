import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Notification } from '../../generated/prisma/client.js';
import { UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { redactSensitiveText } from '../../common/logging/structured-log.js';
import { EmailSender } from './email-sender.js';
import { NotificationsGateway } from './notifications.gateway.js';

interface NotificationJobData {
  kind: 'notification';
  notificationId: string;
}

interface PasswordResetJobData {
  kind: 'password-reset';
  requestId: string;
  email: string;
  token: string;
  expiresAt: string;
}

type EmailJobData = NotificationJobData | PasswordResetJobData;

export interface PasswordResetDelivery {
  requestId: string;
  email: string;
  token: string;
  expiresAt: Date;
}

const EMAIL_NOTIFICATION_TYPES = new Set([
  'SHIPMENT_CREATED',
  'SHIPMENT_CONFIRMED',
  'PICKUP_DRIVER_ASSIGNED',
  'SHIPMENT_PICKED_UP',
  'WAREHOUSE_ARRIVED',
  'DELIVERY_DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURN_STARTED',
]);

@Injectable()
export class NotificationJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationJobsService.name);
  private notificationQueue?: Queue<NotificationJobData>;
  private emailQueue?: Queue<EmailJobData>;
  private notificationWorker?: Worker<NotificationJobData>;
  private emailWorker?: Worker<EmailJobData>;
  private readonly connections: Redis[] = [];

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly emailSender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis.isAvailable?.()) {
      this.logger.warn('BullMQ disabled because Redis is unavailable');
      return;
    }
    const client = this.redis.getClient();
    if (typeof client.duplicate !== 'function') {
      this.logger.warn('BullMQ disabled because the Redis client cannot create connections');
      return;
    }
    const notificationQueueConnection = this.connection(client, 'producer');
    const emailQueueConnection = this.connection(client, 'producer');
    try {
      await Promise.all([notificationQueueConnection.connect(), emailQueueConnection.connect()]);
    } catch (error) {
      notificationQueueConnection.disconnect(false);
      emailQueueConnection.disconnect(false);
      this.connections.length = 0;
      this.logger.warn(
        `BullMQ disabled because Redis became unavailable: ${this.errorMessage(error)}`,
      );
      return;
    }
    const notificationWorkerConnection = this.connection(client, 'worker');
    const emailWorkerConnection = this.connection(client, 'worker');
    this.notificationQueue = new Queue('notification', {
      connection: notificationQueueConnection,
    });
    this.emailQueue = new Queue('email', {
      connection: emailQueueConnection,
    });
    this.notificationWorker = new Worker(
      'notification',
      (job: Job<NotificationJobData>) => this.processNotification(job.data.notificationId),
      { connection: notificationWorkerConnection, concurrency: 10 },
    );
    this.emailWorker = new Worker(
      'email',
      (job: Job<EmailJobData>) =>
        job.data.kind === 'password-reset'
          ? this.processPasswordReset(job.data)
          : this.processEmail(job.data.notificationId),
      { connection: emailWorkerConnection, concurrency: 5 },
    );
    this.notificationWorker.on('failed', (job, error) =>
      this.logger.error(
        `Notification job ${job?.id ?? 'unknown'} failed`,
        redactSensitiveText(error.stack ?? error.message),
      ),
    );
    this.emailWorker.on('failed', (job, error) =>
      this.logger.error(
        `Email job ${job?.id ?? 'unknown'} failed`,
        redactSensitiveText(error.stack ?? error.message),
      ),
    );
    this.notificationWorker.on('error', (error) =>
      this.logger.error(redactSensitiveText(error.message)),
    );
    this.emailWorker.on('error', (error) => this.logger.error(redactSensitiveText(error.message)));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.notificationWorker?.close(),
      this.emailWorker?.close(),
      this.notificationQueue?.close(),
      this.emailQueue?.close(),
    ]);
    await Promise.allSettled(this.connections.map((connection) => connection.quit()));
  }

  async enqueueNotifications(notifications: Notification[]): Promise<void> {
    if (!this.notificationQueue || notifications.length === 0) return;
    try {
      await this.notificationQueue.addBulk(
        notifications.map((notification) => ({
          name: 'deliver-in-app',
          data: { kind: 'notification' as const, notificationId: notification.id },
          opts: this.jobOptions(`notification-${notification.id}`),
        })),
      );
    } catch (error) {
      this.logger.error(`Could not enqueue notifications: ${this.errorMessage(error)}`);
    }
  }

  async enqueuePasswordReset(delivery: PasswordResetDelivery): Promise<void> {
    if (!this.emailSender.enabled) {
      this.logger.log(`SMTP disabled, skipped password reset email ${delivery.requestId}`);
      return;
    }
    if (!this.emailQueue) {
      this.logger.warn(`Email queue unavailable for password reset ${delivery.requestId}`);
      return;
    }

    try {
      await this.emailQueue.add(
        'password-reset',
        {
          kind: 'password-reset',
          requestId: delivery.requestId,
          email: delivery.email,
          token: delivery.token,
          expiresAt: delivery.expiresAt.toISOString(),
        },
        {
          ...this.jobOptions(`password-reset-${delivery.requestId}`),
          removeOnComplete: true,
          removeOnFail: {
            age: Number(this.config.getOrThrow<string>('PASSWORD_RESET_TTL_MINUTES')) * 60,
            count: 1_000,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not enqueue password reset email ${delivery.requestId}: ${this.errorMessage(error)}`,
      );
    }
  }

  async processNotification(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { role: true } } },
    });
    if (!notification) return;
    await this.gateway.emitNotification(notification);
    const shouldEmail =
      notification.user.role === UserRole.CUSTOMER &&
      EMAIL_NOTIFICATION_TYPES.has(notification.type);
    if (!shouldEmail) return;
    if (!this.emailSender.enabled) {
      this.logger.log(`SMTP disabled, skipped email notification ${notification.id}`);
      return;
    }
    await this.enqueueEmail(notification.id);
  }

  async processEmail(notificationId: string): Promise<void> {
    if (!this.emailSender.enabled) {
      this.logger.log(`SMTP disabled, skipped email notification ${notificationId}`);
      return;
    }
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { email: true, role: true } } },
    });
    if (
      !notification ||
      notification.emailSentAt ||
      notification.user.role !== UserRole.CUSTOMER ||
      !EMAIL_NOTIFICATION_TYPES.has(notification.type)
    )
      return;

    const messageId = this.messageId(`notification-${notification.id}`);
    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: notification.id,
        emailSentAt: null,
        emailAttempts: notification.emailAttempts,
      },
      data: { emailAttempts: { increment: 1 }, emailLastError: null },
    });
    if (claimed.count !== 1) return;
    try {
      await this.emailSender.send({
        to: notification.user.email,
        subject: notification.title,
        text: notification.message,
        messageId,
      });
      await this.prisma.notification.updateMany({
        where: { id: notification.id, emailSentAt: null },
        data: { emailSentAt: new Date(), emailMessageId: messageId, emailLastError: null },
      });
    } catch (error) {
      await this.prisma.notification.updateMany({
        where: { id: notification.id, emailSentAt: null },
        data: { emailLastError: this.errorMessage(error).slice(0, 500) },
      });
      throw error;
    }
  }

  async processPasswordReset(data: PasswordResetJobData): Promise<void> {
    if (!this.emailSender.enabled || new Date(data.expiresAt) <= new Date()) return;

    const resetUrl = new URL(this.config.getOrThrow<string>('PASSWORD_RESET_URL'));
    resetUrl.searchParams.set('token', data.token);
    await this.emailSender.send({
      to: data.email,
      subject: 'Reset your Logistics Operations password',
      text: `Use this link to reset your password before ${data.expiresAt}: ${resetUrl.toString()}`,
      messageId: this.messageId(`password-reset-${data.requestId}`),
    });
  }

  private async enqueueEmail(notificationId: string): Promise<void> {
    if (!this.emailQueue) return;
    await this.emailQueue.add(
      'deliver-email',
      { kind: 'notification', notificationId },
      this.jobOptions(`email-${notificationId}`),
    );
  }

  private connection(client: Redis, purpose: 'producer' | 'worker'): Redis {
    const connection = client.duplicate(
      purpose === 'worker'
        ? { lazyConnect: false, maxRetriesPerRequest: null }
        : { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    );
    connection.on('error', (error) =>
      this.logger.error(`BullMQ Redis: ${redactSensitiveText(error.message)}`),
    );
    this.connections.push(connection);
    return connection;
  }

  private jobOptions(jobId: string) {
    return {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 1_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? redactSensitiveText(error.message) : 'unknown queue error';
  }

  private messageId(key: string): string {
    const domain = new URL(this.config.getOrThrow<string>('FRONTEND_URL')).hostname;
    return `<${key}@${domain}>`;
  }
}
