import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Notification } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationJobsService } from './notification-jobs.service.js';

export interface NotificationInput {
  userId: string;
  eventKey: string;
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly cache: CacheService,
    private readonly jobs: NotificationJobsService,
  ) {}

  async createIdempotent(
    transaction: Prisma.TransactionClient,
    inputs: NotificationInput[],
  ): Promise<Notification[]> {
    if (inputs.length === 0) return [];
    await transaction.notification.createMany({
      data: inputs,
      skipDuplicates: true,
    });
    return transaction.notification.findMany({
      where: {
        OR: inputs.map(({ userId, eventKey }) => ({ userId, eventKey })),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async list(userId: string, page: number, limit: number, unreadOnly: boolean) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit), unreadCount };
  }

  async publishByEventKeys(eventKeys: string[]): Promise<void> {
    if (eventKeys.length === 0) return;
    const notifications = await this.prisma.notification.findMany({
      where: { eventKey: { in: eventKeys } },
    });
    await this.jobs.enqueueNotifications(notifications);
  }

  publishAssignmentCreated(input: {
    driverId: string;
    shipmentId: string;
    assignmentId: string;
  }): void {
    void this.gateway.emitAssignmentCreated(input);
  }

  async publishShipmentUpdated(shipmentId: string, status: string): Promise<void> {
    await this.cache.invalidateShipment(shipmentId);
    await this.gateway.emitShipmentUpdated(shipmentId, status);
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const update = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (update.count === 0) {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });
      if (existing) return existing;
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification was not found',
      });
    }
    return this.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
  }

  async markAllRead(userId: string): Promise<{ markedCount: number; unreadCount: 0 }> {
    const update = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { markedCount: update.count, unreadCount: 0 };
  }
}
