export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteRequest {
  origin: RoutePoint;
  destination: RoutePoint;
  includeGeometry?: boolean;
}

export interface RouteGeometry {
  points: RoutePoint[];
}

export interface RoadRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  calculatedAt: Date;
  geometry?: RouteGeometry | null;
}

export interface RouteProvider {
  readonly identifier: string;
  readonly enabled: boolean;
  calculate(request: RouteRequest): Promise<RoadRouteResult>;
}

export const ROUTE_PROVIDER = Symbol('ROUTE_PROVIDER');

export class RouteProviderError extends Error {
  constructor(
    readonly kind: 'DISABLED' | 'TIMEOUT' | 'UPSTREAM' | 'MALFORMED_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'RouteProviderError';
  }
}
