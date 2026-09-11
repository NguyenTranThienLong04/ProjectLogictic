import {
  RouteProviderError,
  type RoadRouteResult,
  type RouteGeometry,
  type RouteProvider,
  type RouteRequest,
} from './route-provider.js';

interface OsrmRouteResponse {
  code?: unknown;
  routes?: unknown;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type RouteFetch = (input: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

export class OsrmRouteProvider implements RouteProvider {
  readonly identifier = 'OSRM';
  readonly enabled = true;
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly timeoutMilliseconds: number,
    private readonly routeFetch: RouteFetch = fetch,
    private readonly maxGeometryPoints = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async calculate(request: RouteRequest): Promise<RoadRouteResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      const response = await this.routeFetch(this.url(request), { signal: controller.signal });
      if (!response.ok) {
        throw new RouteProviderError(
          'UPSTREAM',
          `OSRM returned upstream status ${response.status}`,
        );
      }
      const payload = (await response.json()) as OsrmRouteResponse;
      const routes: unknown = payload.routes;
      const route: unknown = Array.isArray(routes) ? (routes as unknown[])[0] : null;
      if (
        payload.code !== 'Ok' ||
        !route ||
        typeof route !== 'object' ||
        !Number.isFinite((route as { distance?: unknown }).distance) ||
        Number((route as { distance: number }).distance) < 0 ||
        !Number.isFinite((route as { duration?: unknown }).duration) ||
        Number((route as { duration: number }).duration) < 0
      ) {
        throw new RouteProviderError('MALFORMED_RESPONSE', 'OSRM response is malformed');
      }
      const geometry = request.includeGeometry
        ? this.normalizeGeometry((route as { geometry?: unknown }).geometry)
        : null;
      return {
        distanceMeters: Math.round(Number((route as { distance: number }).distance)),
        durationSeconds: Math.round(Number((route as { duration: number }).duration)),
        provider: this.identifier,
        calculatedAt: new Date(),
        geometry,
      };
    } catch (error) {
      if (error instanceof RouteProviderError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new RouteProviderError('TIMEOUT', 'OSRM request timed out');
      }
      throw new RouteProviderError('UPSTREAM', 'OSRM request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private url(request: RouteRequest): string {
    const coordinates = `${request.origin.longitude},${request.origin.latitude};${request.destination.longitude},${request.destination.latitude}`;
    return request.includeGeometry
      ? `${this.baseUrl}/route/v1/driving/${coordinates}?overview=simplified&geometries=geojson&steps=false`
      : `${this.baseUrl}/route/v1/driving/${coordinates}?overview=false&steps=false`;
  }

  private normalizeGeometry(value: unknown): RouteGeometry {
    if (!value || typeof value !== 'object') this.malformedGeometry();
    const candidate = value as { type?: unknown; coordinates?: unknown };
    if (
      candidate.type !== 'LineString' ||
      !Array.isArray(candidate.coordinates) ||
      candidate.coordinates.length < 2 ||
      candidate.coordinates.length > this.maxGeometryPoints
    ) {
      this.malformedGeometry();
    }
    const points = candidate.coordinates.map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) this.malformedGeometry();
      const [longitude, latitude] = coordinate as unknown[];
      if (
        !Number.isFinite(latitude) ||
        Number(latitude) < -90 ||
        Number(latitude) > 90 ||
        !Number.isFinite(longitude) ||
        Number(longitude) < -180 ||
        Number(longitude) > 180
      ) {
        this.malformedGeometry();
      }
      return { latitude: Number(latitude), longitude: Number(longitude) };
    });
    return { points };
  }

  private malformedGeometry(): never {
    throw new RouteProviderError('MALFORMED_RESPONSE', 'OSRM route geometry is malformed');
  }
}
