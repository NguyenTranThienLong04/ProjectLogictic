import type { RouteMetricView } from '../../utils/route-metric';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteGeometry {
  points: RoutePoint[];
}

export type RouteDeviationState = 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN';

export interface RouteDeviation {
  state: RouteDeviationState;
  distanceFromRouteMeters: number | null;
  detectedAt: string | null;
}

export interface LineHaulRouteView extends RouteMetricView {
  id?: string;
  version?: number;
  type?: 'PLANNED' | 'REROUTE';
  start?: RoutePoint;
  destination?: RoutePoint;
  geometry?: RouteGeometry | null;
  createdAt?: string;
  createdById?: string | null;
}
