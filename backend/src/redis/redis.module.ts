import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [RedisService, CacheService],
  exports: [RedisService, CacheService],
})
export class RedisModule {}
