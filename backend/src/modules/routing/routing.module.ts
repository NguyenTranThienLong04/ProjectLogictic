import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from '../../redis/redis.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DisabledRouteProvider } from './disabled-route.provider.js';
import { OsrmRouteProvider } from './osrm-route.provider.js';
import { ROUTE_PROVIDER, type RouteProvider } from './route-provider.js';
import { RouteMetricsService } from './route-metrics.service.js';
import { RouteDeviationService } from './route-deviation.service.js';

const configuredRouteProvider: Provider<RouteProvider> = {
  provide: ROUTE_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RouteProvider => {
    if (config.getOrThrow<string>('ROUTE_PROVIDER') === 'OSRM') {
      return new OsrmRouteProvider(
        config.getOrThrow<string>('ROUTE_PROVIDER_BASE_URL'),
        Number(config.getOrThrow<string>('ROUTE_TIMEOUT_MS')),
        undefined,
        Number(config.getOrThrow<string>('ROUTE_GEOMETRY_MAX_POINTS')),
      );
    }
    return new DisabledRouteProvider();
  },
};

@Module({
  imports: [RedisModule, NotificationsModule],
  providers: [configuredRouteProvider, RouteMetricsService, RouteDeviationService],
  exports: [RouteMetricsService, RouteDeviationService],
})
export class RoutingModule {}
