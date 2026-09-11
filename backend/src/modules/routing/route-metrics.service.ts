import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../redis/cache.service.js';
import {
  ROUTE_PROVIDER,
  type RoadRouteResult,
  type RouteGeometry,
  type RoutePoint,
  type RouteProvider,
  type RouteRequest,
} from './route-provider.js';

export type RouteMetricMode = 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';

export interface RouteMetric {
  distanceMeters: number;
  durationSeconds: number | null;
  provider: string;
  calculatedAt: Date;
  mode: RouteMetricMode;
  geometry?: RouteGeometry | null;
}

interface CachedRoadRoute {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  calculatedAt: Date | string;
  geometry?: RouteGeometry | null;
}

export function haversineDistanceMeters(origin: RoutePoint, destination: RoutePoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const fromLatitudeRadians = radians(origin.latitude);
  const toLatitudeRadians = radians(destination.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

@Injectable()
export class RouteMetricsService {
  private readonly logger = new Logger(RouteMetricsService.name);
  private readonly cacheTtlSeconds: number;
  private readonly batchConcurrency: number;
  private readonly batchExternalCallLimit: number;
  private readonly maxGeometryPoints: number;

  constructor(
    @Inject(ROUTE_PROVIDER) private readonly routeProvider: RouteProvider,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds = Number(config.getOrThrow<string>('ROUTE_CACHE_TTL_SECONDS'));
    this.batchConcurrency = Number(config.getOrThrow<string>('ROUTE_BATCH_CONCURRENCY'));
    this.batchExternalCallLimit = Number(
      config.getOrThrow<string>('ROUTE_BATCH_EXTERNAL_CALL_LIMIT'),
    );
    this.maxGeometryPoints = Number(config.getOrThrow<string>('ROUTE_GEOMETRY_MAX_POINTS'));
  }

  async calculate(request: RouteRequest): Promise<RouteMetric> {
    return (await this.calculateInternal(request, false, false)) ?? this.fallback(request);
  }

  async calculateWithGeometry(request: RouteRequest): Promise<RouteMetric> {
    return (
      (await this.calculateInternal({ ...request, includeGeometry: true }, true, false)) ??
      this.fallback(request)
    );
  }

  async calculateRoadRouteWithGeometry(request: RouteRequest): Promise<RouteMetric | null> {
    if (!this.routeProvider.enabled) return null;
    return this.calculateInternal({ ...request, includeGeometry: true }, true, true);
  }

  get roadProviderEnabled(): boolean {
    return this.routeProvider.enabled;
  }

  private async calculateInternal(
    request: RouteRequest,
    requestGeometry: boolean,
    requireGeometry: boolean,
  ): Promise<RouteMetric | null> {
    this.assertPoint(request.origin);
    this.assertPoint(request.destination);
    if (!this.routeProvider.enabled) return requireGeometry ? null : this.fallback(request);

    const cacheKey = this.cacheKey(request, requestGeometry);
    const cached = await this.cache.get<CachedRoadRoute>(cacheKey);
    if (this.isRoadRoute(cached, requireGeometry)) return this.roadRoute(cached);

    try {
      const result = await this.routeProvider.calculate(request);
      if (
        !this.isRoadRoute(result, requireGeometry) ||
        result.provider !== this.routeProvider.identifier
      ) {
        throw new Error('Route provider returned an invalid metric');
      }
      await this.cache.set(cacheKey, result, this.cacheTtlSeconds);
      return this.roadRoute(result);
    } catch {
      this.logger.warn(
        requireGeometry
          ? `Route provider ${this.routeProvider.identifier} unavailable for route geometry`
          : `Route provider ${this.routeProvider.identifier} unavailable; using Haversine fallback`,
      );
      return requireGeometry ? null : this.fallback(request);
    }
  }

  async calculateBatch(requests: RouteRequest[]): Promise<RouteMetric[]> {
    const roadRequests = requests.slice(0, this.batchExternalCallLimit);
    const results = await this.mapWithConcurrency(roadRequests, (request) =>
      this.calculate(request),
    );
    return [
      ...results,
      ...requests.slice(this.batchExternalCallLimit).map((request) => this.fallback(request)),
    ];
  }

  fallback(request: RouteRequest, calculatedAt = new Date()): RouteMetric {
    this.assertPoint(request.origin);
    this.assertPoint(request.destination);
    return {
      distanceMeters: haversineDistanceMeters(request.origin, request.destination),
      durationSeconds: null,
      provider: 'HAVERSINE',
      calculatedAt,
      mode: 'HAVERSINE_FALLBACK',
      geometry: null,
    };
  }

  private roadRoute(result: CachedRoadRoute | RoadRouteResult): RouteMetric {
    return {
      distanceMeters: Math.round(result.distanceMeters),
      durationSeconds: Math.round(result.durationSeconds),
      provider: result.provider,
      calculatedAt:
        result.calculatedAt instanceof Date ? result.calculatedAt : new Date(result.calculatedAt),
      mode: 'ROAD_ROUTE',
      geometry: result.geometry ?? null,
    };
  }

  private isRoadRoute(
    value: CachedRoadRoute | RoadRouteResult | null,
    requireGeometry: boolean,
  ): value is CachedRoadRoute {
    if (!value) return false;
    const calculatedAt =
      value.calculatedAt instanceof Date
        ? value.calculatedAt.getTime()
        : Date.parse(value.calculatedAt);
    return (
      Number.isInteger(value.distanceMeters) &&
      value.distanceMeters >= 0 &&
      Number.isInteger(value.durationSeconds) &&
      value.durationSeconds >= 0 &&
      typeof value.provider === 'string' &&
      value.provider.length > 0 &&
      Number.isFinite(calculatedAt) &&
      (!requireGeometry || this.isGeometry(value.geometry)) &&
      (value.geometry === undefined || value.geometry === null || this.isGeometry(value.geometry))
    );
  }

  private isGeometry(value: unknown): value is RouteGeometry {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as RouteGeometry).points) &&
      (value as RouteGeometry).points.length >= 2 &&
      (value as RouteGeometry).points.length <= this.maxGeometryPoints &&
      (value as RouteGeometry).points.every((point) => {
        try {
          this.assertPoint(point);
          return true;
        } catch {
          return false;
        }
      })
    );
  }

  private cacheKey(request: RouteRequest, geometry = false): string {
    const point = (value: RoutePoint) =>
      `${value.latitude.toFixed(4)},${value.longitude.toFixed(4)}`;
    const mode = geometry ? 'road_route_geometry' : 'road_route';
    return `route:${this.routeProvider.identifier.toLowerCase()}:${mode}:${point(request.origin)}:${point(request.destination)}`;
  }

  private assertPoint(point: RoutePoint): void {
    if (
      !Number.isFinite(point.latitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      !Number.isFinite(point.longitude) ||
      point.longitude < -180 ||
      point.longitude > 180
    ) {
      throw new Error('Route coordinates must be valid latitude/longitude values');
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.batchConcurrency, items.length) }, () => worker()),
    );
    return results;
  }
}
