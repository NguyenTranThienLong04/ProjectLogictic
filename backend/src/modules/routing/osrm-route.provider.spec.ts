import { jest } from '@jest/globals';
import { OsrmRouteProvider } from './osrm-route.provider.js';
import { RouteProviderError, type RouteRequest } from './route-provider.js';

const request: RouteRequest = {
  origin: { latitude: 10.7769, longitude: 106.7009 },
  destination: { latitude: 10.8231, longitude: 106.6297 },
};

describe('OsrmRouteProvider', () => {
  it('maps a successful route response to bounded integer metrics', async () => {
    const routeFetch = jest.fn((input: string, init: { signal: AbortSignal }) => {
      void input;
      void init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ code: 'Ok', routes: [{ distance: 12_345.4, duration: 987.6 }] }),
      });
    });
    const provider = new OsrmRouteProvider('https://router.example.test/', 100, routeFetch);

    await expect(provider.calculate(request)).resolves.toMatchObject({
      distanceMeters: 12_345,
      durationSeconds: 988,
      provider: 'OSRM',
    });
    expect(routeFetch).toHaveBeenCalledTimes(1);
    const [requestedUrl, requestedOptions] = routeFetch.mock.calls[0];
    expect(requestedUrl).toBe(
      'https://router.example.test/route/v1/driving/106.7009,10.7769;106.6297,10.8231?overview=false&steps=false',
    );
    expect(requestedOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('normalizes requested GeoJSON coordinates into vendor-neutral latitude/longitude points', async () => {
    const routeFetch = jest.fn((input: string, init: { signal: AbortSignal }) => {
      void input;
      void init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            code: 'Ok',
            routes: [
              {
                distance: 12_345,
                duration: 988,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [106.7009, 10.7769],
                    [106.6297, 10.8231],
                  ],
                },
              },
            ],
          }),
      });
    });
    const provider = new OsrmRouteProvider('https://router.example.test', 100, routeFetch);

    await expect(provider.calculate({ ...request, includeGeometry: true })).resolves.toMatchObject({
      geometry: {
        points: [
          { latitude: 10.7769, longitude: 106.7009 },
          { latitude: 10.8231, longitude: 106.6297 },
        ],
      },
    });
    expect(routeFetch.mock.calls[0][0]).toContain(
      '?overview=simplified&geometries=geojson&steps=false',
    );
  });

  it.each([
    ['missing geometry', undefined, 2_000],
    [
      'invalid coordinate',
      {
        type: 'LineString',
        coordinates: [
          [106.7, 95],
          [106.8, 10.8],
        ],
      },
      2_000,
    ],
    [
      'excessive point count',
      {
        type: 'LineString',
        coordinates: [
          [106.7, 10.7],
          [106.8, 10.8],
          [106.9, 10.9],
        ],
      },
      2,
    ],
  ])('rejects %s when geometry is requested', async (_label, geometry, maxPoints) => {
    const provider = new OsrmRouteProvider(
      'https://router.example.test',
      100,
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ code: 'Ok', routes: [{ distance: 10, duration: 5, geometry }] }),
        }),
      maxPoints,
    );

    await expect(provider.calculate({ ...request, includeGeometry: true })).rejects.toMatchObject({
      kind: 'MALFORMED_RESPONSE',
    });
  });

  it('classifies a bounded request timeout without exposing the route URL', async () => {
    const routeFetch = jest.fn(
      (_input: string, init: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const provider = new OsrmRouteProvider(
      'https://secret.example.test/token-value',
      5,
      routeFetch,
    );

    const error = await provider.calculate(request).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RouteProviderError);
    expect(error).toMatchObject({ kind: 'TIMEOUT', message: 'OSRM request timed out' });
    expect(String(error)).not.toContain('secret.example.test');
    expect(String(error)).not.toContain('token-value');
  });

  it('rejects malformed successful responses', async () => {
    const provider = new OsrmRouteProvider('https://router.example.test', 100, () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 'Ok', routes: [{ distance: 'unknown' }] }),
      }),
    );

    await expect(provider.calculate(request)).rejects.toMatchObject({
      kind: 'MALFORMED_RESPONSE',
    });
  });

  it('classifies upstream HTTP failures', async () => {
    const provider = new OsrmRouteProvider('https://router.example.test', 100, () =>
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    );

    await expect(provider.calculate(request)).rejects.toMatchObject({ kind: 'UPSTREAM' });
  });
});
