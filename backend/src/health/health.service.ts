import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export type DependencyStatus = 'up' | 'down';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async checkReadiness(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (cause) {
      throw new ServiceUnavailableException('Database readiness check failed', { cause });
    }

    let redis: DependencyStatus = 'up';
    try {
      await this.redis.getClient().ping();
    } catch {
      redis = 'down';
    }

    return {
      status: redis === 'up' ? 'ok' : 'degraded',
      checks: {
        database: 'up',
        redis,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
