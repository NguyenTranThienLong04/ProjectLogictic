import type { RouteDeviation, RouteGeometry } from '../line-haul/line-haul-route-types';

export interface DriverLocation {
  driverId: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

export type DriverTaskLocationKind = 'PICKUP' | 'DESTINATION_WAREHOUSE' | 'RECEIVER';

export interface DriverTaskLocation {
  kind: DriverTaskLocationKind;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface OperationalDriverLocation extends DriverLocation {
  fullName: string;
  employeeCode: string;
  vehiclePlate: string;
}

export interface LineHaulLocation {
  tripId: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
}

export type LineHaulLocationState = 'CURRENT' | 'MISSING' | 'STALE' | 'UNAVAILABLE' | 'DISABLED';

export interface LineHaulMapWarehouse {
  id: string;
  code: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LineHaulTripLocation {
  tripId: string;
  tripCode: string;
  status: 'PLANNED' | 'READY' | 'IN_TRANSIT' | 'ARRIVED' | 'CANCELLED';
  departedAt: string | null;
  locationState: LineHaulLocationState;
  location: LineHaulLocation | null;
  lastCapturedAt: string | null;
  route: {
    version: number;
    type: 'PLANNED' | 'REROUTE';
    distanceMeters: number;
    durationSeconds: number | null;
    geometry: RouteGeometry | null;
    calculatedAt: string;
  } | null;
  remainingRoute: {
    distanceMeters: number;
    durationSeconds: number | null;
    mode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
    calculatedAt: string;
  } | null;
  deviation: RouteDeviation;
  driver: { id: string; fullName: string; employeeCode: string };
  vehicle: { id: string; vehicleCode: string; licensePlate: string; vehicleType: string };
  origin: LineHaulMapWarehouse;
  destination: LineHaulMapWarehouse;
}

export interface LineHaulTripEnded {
  tripId: string;
  status: 'ARRIVED';
  arrivedAt: string;
}

export interface LineHaulRouteDeviationChanged extends RouteDeviation {
  tripId: string;
  detectedAt: string;
}

export interface LineHaulRouteUpdated {
  tripId: string;
  routeVersion: number;
  calculatedAt: string;
}
