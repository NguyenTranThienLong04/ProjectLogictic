import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { RedisService } from '../../redis/redis.service.js';
import type { NotificationsGateway } from '../notifications/notifications.gateway.js';
import { distanceToRouteMeters, RouteDeviationService } from './route-deviation.service.js';
import type { RouteGeometry } from './route-provider.js';

const tripId = '44444444-4444-4444-8444-444444444444';
const geometry: RouteGeometry = {
  points: [
    { latitude: 10, longitude: 106 },
    { latitude: 10, longitude: 107 },
  ],
};

function fixture() {
  const values = new Map<string, string>();
  const get = jest.fn((key: string) => Promise.resolve(values.get(key) ?? null));
  const set = jest.fn((key: string, value: string) => {
    values.set(key, value);
    return Promise.resolve('OK');
  });
  const emitLineHaulRouteDeviationChanged = jest.fn();
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'LINE_HAUL_ROUTE_DEVIATION_METERS' ? '500' : '3',
    ),
  } as unknown as ConfigService;
  const redis = { getClient: jest.fn(() => ({ get, set })) } as unknown as RedisService;
  const notifications = {
    emitLineHaulRouteDeviationChanged,
  } as unknown as NotificationsGateway;
  return {
    service: new RouteDeviationService(config, redis, notifications),
    emitLineHaulRouteDeviationChanged,
  };
}

describe('RouteDeviationService', () => {
  it('calculates the nearest distance to any route segment', () => {
    expect(distanceToRouteMeters({ latitude: 10, longitude: 106.5 }, geometry)).toBeLessThan(1);
    expect(distanceToRouteMeters({ latitude: 10.01, longitude: 106.5 }, geometry)).toBeGreaterThan(
      1_000,
    );
  });

  it('marks an on-route sample and emits only on the actual state change', async () => {
    const { service, emitLineHaulRouteDeviationChanged } = fixture();
    const input = {
      tripId,
      routeVersion: 1,
      geometry,
      location: { latitude: 10, longitude: 106.5 },
      capturedAt: '2026-09-06T01:00:00.000Z',
    };

    await expect(service.evaluate(input)).resolves.toMatchObject({
      state: 'ON_ROUTE',
      distanceFromRouteMeters: 0,
    });
    await service.evaluate({ ...input, capturedAt: '2026-09-06T01:00:05.000Z' });

    expect(emitLineHaulRouteDeviationChanged).toHaveBeenCalledTimes(1);
    expect(emitLineHaulRouteDeviationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ tripId, state: 'ON_ROUTE', distanceFromRouteMeters: 0 }),
    );
  });

  it('filters GPS noise and changes to DEVIATED only after three consecutive samples', async () => {
    const { service, emitLineHaulRouteDeviationChanged } = fixture();
    const sample = (latitude: number, second: number) =>
      service.evaluate({
        tripId,
        routeVersion: 1,
        geometry,
        location: { latitude, longitude: 106.5 },
        capturedAt: `2026-09-06T01:00:${String(second).padStart(2, '0')}.000Z`,
      });

    await expect(sample(10, 0)).resolves.toMatchObject({ state: 'ON_ROUTE' });
    await expect(sample(10.01, 5)).resolves.toMatchObject({ state: 'ON_ROUTE' });
    await expect(sample(10.01, 10)).resolves.toMatchObject({ state: 'ON_ROUTE' });
    await expect(sample(10.01, 15)).resolves.toMatchObject({ state: 'DEVIATED' });

    expect(emitLineHaulRouteDeviationChanged).toHaveBeenCalledTimes(2);
    expect(emitLineHaulRouteDeviationChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ tripId, state: 'DEVIATED' }),
    );
  });

  it('resets the consecutive counter when a sample returns below the threshold', async () => {
    const { service } = fixture();
    const evaluate = (latitude: number, second: number) =>
      service.evaluate({
        tripId,
        routeVersion: 1,
        geometry,
        location: { latitude, longitude: 106.5 },
        capturedAt: `2026-09-06T01:01:${String(second).padStart(2, '0')}.000Z`,
      });

    await evaluate(10.01, 0);
    await evaluate(10.01, 5);
    await expect(evaluate(10, 10)).resolves.toMatchObject({ state: 'ON_ROUTE' });
    await expect(evaluate(10.01, 15)).resolves.toMatchObject({ state: 'ON_ROUTE' });
  });

  it('uses route-versioned state so a reroute starts UNKNOWN without overwriting history', async () => {
    const { service } = fixture();
    await service.evaluate({
      tripId,
      routeVersion: 1,
      geometry,
      location: { latitude: 10, longitude: 106.5 },
      capturedAt: '2026-09-06T01:02:00.000Z',
    });

    await expect(service.read(tripId, 2)).resolves.toEqual({
      state: 'UNKNOWN',
      distanceFromRouteMeters: null,
      detectedAt: null,
    });
    await expect(service.read(tripId, 1)).resolves.toMatchObject({ state: 'ON_ROUTE' });
  });
});
