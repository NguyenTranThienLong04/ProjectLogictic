import { createContext, useContext } from 'react';
import type { LineHaulTripLocation } from './location-types';

export type DriverGpsState =
  | 'LOCATING'
  | 'CURRENT'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'DISABLED';

export interface DriverLocationContextValue {
  activeLineHaulTrip: LineHaulTripLocation | null | undefined;
  activeTripLoading: boolean;
  activeTripError: unknown;
  gpsState: DriverGpsState;
  gpsMessage: string | null;
  refreshActiveTrip: () => void;
}

export const DriverLocationContext = createContext<DriverLocationContextValue | null>(null);

export function useDriverLocationProvider(): DriverLocationContextValue {
  const value = useContext(DriverLocationContext);
  if (!value)
    throw new Error('useDriverLocationProvider must be used inside DriverLocationProvider');
  return value;
}
