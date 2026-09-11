import { Injectable } from '@nestjs/common';
import { RouteProviderError, type RoadRouteResult, type RouteProvider } from './route-provider.js';

@Injectable()
export class DisabledRouteProvider implements RouteProvider {
  readonly identifier = 'DISABLED';
  readonly enabled = false;

  calculate(): Promise<RoadRouteResult> {
    return Promise.reject(
      new RouteProviderError('DISABLED', 'External road routing is not configured'),
    );
  }
}
