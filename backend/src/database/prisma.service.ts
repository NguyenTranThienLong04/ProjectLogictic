import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { startupStep } from '../common/startup.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 10_000,
    });
    super({
      adapter,
      transactionOptions: {
        maxWait: 15_000,
        timeout: 20_000,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await startupStep('Database', async () => {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
