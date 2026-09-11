import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from './redis.service.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  readonly trackingTtlSeconds: number;
  readonly shipmentTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.trackingTtlSeconds = config.getOrThrow<number>('CACHE_TRACKING_TTL_SECONDS');
    this.shipmentTtlSeconds = config.getOrThrow<number>('CACHE_SHIPMENT_TTL_SECONDS');
  }

  trackingKey(trackingCode: string): string {
    return `tracking:${trackingCode.trim().toUpperCase()}`;
  }

  shipmentSummaryKey(shipmentId: string): string {
    return `shipment:${shipmentId}:summary`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.getClient().get(key);
      if (!value) return null;
      return JSON.parse(value, (_key: string, candidate: unknown) => {
        if (typeof candidate === 'string' && ISO_DATE.test(candidate)) return new Date(candidate);
        return candidate;
      }) as T;
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${this.errorMessage(error)}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${this.errorMessage(error)}`);
    }
  }

  async invalidateShipment(shipmentId: string, trackingCode?: string): Promise<void> {
    let resolvedTrackingCode = trackingCode;
    if (!resolvedTrackingCode) {
      try {
        const shipment = await this.prisma.shipment.findUnique({
          where: { id: shipmentId },
          select: { trackingCode: true },
        });
        resolvedTrackingCode = shipment?.trackingCode;
      } catch (error) {
        this.logger.warn(
          `Could not resolve tracking code for cache invalidation: ${this.errorMessage(error)}`,
        );
      }
    }

    const keys = [this.shipmentSummaryKey(shipmentId)];
    if (resolvedTrackingCode) keys.push(this.trackingKey(resolvedTrackingCode));
    try {
      await this.redis.getClient().del(...keys);
    } catch (error) {
      this.logger.warn(`Cache invalidation failed for ${shipmentId}: ${this.errorMessage(error)}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown Redis error';
  }
}
