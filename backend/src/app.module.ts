import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { validateEnvironment } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RedisService } from './redis/redis.service.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AddressesModule } from './modules/addresses/addresses.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AssignmentsModule } from './modules/assignments/assignments.module.js';
import { WarehousesModule } from './modules/warehouses/warehouses.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { CodModule } from './modules/cod/cod.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { DashboardsModule } from './modules/dashboards/dashboards.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { HealthModule } from './health/health.module.js';
import { LineHaulModule } from './modules/line-haul/line-haul.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../.env', '.env'],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [{ ttl: 60_000, limit: 100 }],
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    PricingModule,
    ShipmentsModule,
    DriversModule,
    NotificationsModule,
    AssignmentsModule,
    WarehousesModule,
    LocationsModule,
    CodModule,
    AnalyticsModule,
    DashboardsModule,
    AuditModule,
    LineHaulModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
