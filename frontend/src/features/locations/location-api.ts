import { api } from '../../services/api';
export type AddressSearchInput = { street: string; ward: string; district?: string; city: string };
export type AddressSearchResult = {
  id: string; displayName: string; latitude: number; longitude: number;
  houseNumber?: string; road?: string; ward?: string; city?: string;
};

export async function searchAddress(input: AddressSearchInput, signal?: AbortSignal): Promise<AddressSearchResult[]> {
  const response = await api.post<ApiEnvelope<AddressSearchResult[]>>('/locations/address-search', input, { signal });
  return response.data.data;
}
import type { ApiEnvelope } from '../../types/auth';
import type {
  DriverLocation,
  LineHaulLocation,
  LineHaulTripLocation,
  OperationalDriverLocation,
} from './location-types';

export async function updateDriverLocation(input: {
  latitude: number;
  longitude: number;
}): Promise<DriverLocation> {
  const response = await api.post<ApiEnvelope<DriverLocation>>('/driver/location', input);
  return response.data.data;
}

export async function getMyDriverLocation(): Promise<DriverLocation | null> {
  const response = await api.get<ApiEnvelope<DriverLocation | null>>('/driver/location');
  return response.data.data;
}

export async function getShipmentLocation(shipmentId: string): Promise<DriverLocation | null> {
  const response = await api.get<ApiEnvelope<DriverLocation | null>>(
    `/shipments/${shipmentId}/location`,
  );
  return response.data.data;
}

export async function listOperationalDriverLocations(): Promise<OperationalDriverLocation[]> {
  const response = await api.get<ApiEnvelope<OperationalDriverLocation[]>>(
    '/dispatcher/driver-locations',
  );
  return response.data.data;
}

export async function updateLineHaulTripLocation(
  tripId: string,
  input: { latitude: number; longitude: number },
): Promise<LineHaulLocation> {
  const response = await api.post<ApiEnvelope<LineHaulLocation>>(
    `/driver/line-haul/trips/${tripId}/location`,
    input,
  );
  return response.data.data;
}

export async function getMyActiveLineHaulTrip(): Promise<LineHaulTripLocation | null> {
  const response = await api.get<ApiEnvelope<LineHaulTripLocation | null>>(
    '/driver/line-haul/active-trip',
  );
  return response.data.data;
}

export async function listActiveLineHaulLocations(): Promise<LineHaulTripLocation[]> {
  const response = await api.get<ApiEnvelope<LineHaulTripLocation[]>>('/line-haul/locations');
  return response.data.data;
}

export async function getLineHaulTripLocation(tripId: string): Promise<LineHaulTripLocation> {
  const response = await api.get<ApiEnvelope<LineHaulTripLocation>>(
    `/line-haul/trips/${tripId}/location`,
  );
  return response.data.data;
}
