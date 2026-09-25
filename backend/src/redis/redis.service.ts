import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redactSensitiveText } from '../common/logging/structured-log.js';
import { startupStep } from '../common/startup.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly requiredAtStartup: boolean;
  private reconnectAfterReady = false;

  constructor(configService: ConfigService) {
    this.requiredAtStartup = configService.getOrThrow<string>('NODE_ENV') === 'production';
    this.client = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: 10_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => (this.reconnectAfterReady ? Math.min(attempt * 50, 2_000) : null),
    });
    this.client.on('error', (error) =>
      this.logger.warn(`Redis connection error: ${redactSensitiveText(error.message)}`),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await startupStep('Redis', async () => {
        await this.client.connect();
        await this.client.ping();
      });
      this.reconnectAfterReady = true;
    } catch (error) {
      this.client.disconnect(false);
      if (this.requiredAtStartup) {
        throw new Error('Redis is required but unavailable during production startup', {
          cause: error,
        });
      }
      this.logger.warn(
        `Redis unavailable; cache and async delivery are degraded: ${
          error instanceof Error ? redactSensitiveText(error.message) : 'unknown error'
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    this.reconnectAfterReady = false;
    if (this.client.status !== 'end') this.client.disconnect(false);
  }

  isAvailable(): boolean {
    return this.client.status === 'ready';
  }

  getClient(): Redis {
    return this.client;
  }
}
