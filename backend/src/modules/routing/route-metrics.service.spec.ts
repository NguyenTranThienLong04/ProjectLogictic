import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { CacheService } from '../../redis/cache.service.js';
import type { RouteProvider, RouteRequest } from './route-provider.js';
import { RouteMetricsService } from './route-metrics.service.js';

const request: RouteRequest = {
  origin: { latitude: 10.7769, longitude: 106.7009 },
  destination: { latitude: 10.8231, longitude: 106.6297 },
};

function buildService(options?: {
  cached?: unknown;
  providerResult?: unknown;
  providerError?: Error;
  enabled?: boolean;
}) {
  const cacheGet = jest.fn(() => Promise.resolve(options?.cached ?? null));
  const cacheSet = jest.fn(() => Promise.resolve());
  const cache = {
    get: cacheGet,
    set: cacheSet,
  } as unknown as CacheService;
  const providerCalculate = jest.fn(() => {
    if (options?.providerError) return Promise.reject(options.providerError);
    return Promise.resolve(
      (options?.providerResult as Awaited<ReturnType<RouteProvider['calculate']>>) ?? {
        distanceMeters: 8_000,
        durationSeconds: 600,
        provider: 'TEST_ROAD',
        calculatedAt: new Date('2026-09-05T01:00:00.000Z'),
      },
    );
  });
  const provider: RouteProvider = {
    identifier: 'TEST_ROAD',
    enabled: options?.enabled ?? true,
    calculate: providerCalculate,
  };
  const values: Record<string, string> = {
    ROUTE_CACHE_TTL_SECONDS: '900',
    ROUTE_BATCH_CONCURRENCY: '2',
    ROUTE_BATCH_EXTERNAL_CALL_LIMIT: '2',
    ROUTE_GEOMETRY_MAX_POINTS: '2000',
  };
  const config = {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return {
    service: new RouteMetricsService(provider, cache, config),
    providerCalculate,
    cacheSet,
  };
}

describe('RouteMetricsService', () => {
  let warnings: unknown[][];

  beforeEach(() => {
    warnings = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown, ...optionalParams: unknown[]) => {
        warnings.push([message, ...optionalParams]);
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses a road provider on cache miss and stores the successful metric', async () => {
    const { service, providerCalculate, cacheSet } = buildService();

    await expect(service.calculate(request)).resolves.toMatchObject({
      distanceMeters: 8_000,
      durationSeconds: 600,
      provider: 'TEST_ROAD',
      mode: 'ROAD_ROUTE',
    });
    expect(providerCalculate).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(
      'route:test_road:road_route:10.7769,106.7009:10.8231,106.6297',
      expect.objectContaining({ distanceMeters: 8_000 }),
      900,
    );
  });

  it('returns a valid cache hit without calling the provider', async () => {
    const { service, providerCalculate } = buildService({
      cached: {
        distanceMeters: 7_500,
        durationSeconds: 550,
        provider: 'TEST_ROAD',
        calculatedAt: '2026-09-05T01:00:00.000Z',
      },
    });

    await expect(service.calculate(request)).resolves.toMatchObject({
      distanceMeters: 7_500,
      durationSeconds: 550,
      mode: 'ROAD_ROUTE',
    });
    expect(providerCalculate).not.toHaveBeenCalled();
  });

  it('requests and caches normalized route geometry separately from metric-only calls', async () => {
    const geometry = {
      points: [request.origin, request.destination],
    };
    const { service, providerCalculate, cacheSet } = buildService({
      providerResult: {
        distanceMeters: 8_000,
        durationSeconds: 600,
        provider: 'TEST_ROAD',
        calculatedAt: new Date('2026-09-05T01:00:00.000Z'),
        geometry,
      },
    });

    await expect(service.calculateWithGeometry(request)).resolves.toMatchObject({ geometry });
    expect(providerCalculate).toHaveBeenCalledWith({ ...request, includeGeometry: true });
    expect(cacheSet).toHaveBeenCalledWith(
      'route:test_road:road_route_geometry:10.7769,106.7009:10.8231,106.6297',
      expect.objectContaining({ geometry }),
      900,
    );
  });

  it('returns unavailable instead of a fake reroute when provider geometry is absent', async () => {
    const unavailable = buildService({ enabled: false });
    const malformed = buildService();

    await expect(unavailable.service.calculateRoadRouteWithGeometry(request)).resolves.toBeNull();
    await expect(malformed.service.calculateRoadRouteWithGeometry(request)).resolves.toBeNull();
  });

  it.each([
    ['timeout', new Error('timeout')],
    ['malformed response', new Error('malformed')],
    ['upstream error', new Error('upstream')],
  ])('falls back to Haversine without a fake ETA on %s', async (_label, providerError) => {
    const { service } = buildService({ providerError });

    const metric = await service.calculate(request);

    expect(metric).toMatchObject({
      mode: 'HAVERSINE_FALLBACK',
      provider: 'HAVERSINE',
      durationSeconds: null,
    });
    expect(metric.distanceMeters).toBeGreaterThan(0);
  });

  it('logs only the provider identifier when upstream details contain a secret', async () => {
    const { service } = buildService({
      providerError: new Error('request failed with apiKey=must-not-leak'),
    });

    await service.calculate(request);

    expect(warnings).toEqual([['Route provider TEST_ROAD unavailable; using Haversine fallback']]);
    expect(JSON.stringify(warnings)).not.toContain('must-not-leak');
  });

  it('bounds external batch calls and returns honest fallback metrics for the remainder', async () => {
    const { service, providerCalculate } = buildService();
    const metrics = await service.calculateBatch([request, request, request]);

    expect(providerCalculate).toHaveBeenCalledTimes(2);
    expect(metrics.map((metric) => metric.mode)).toEqual([
      'ROAD_ROUTE',
      'ROAD_ROUTE',
      'HAVERSINE_FALLBACK',
    ]);
    expect(metrics[2].durationSeconds).toBeNull();
  });
});
