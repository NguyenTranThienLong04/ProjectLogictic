import type { AddressSnapshot } from '../shipments/shipment.response.js';

export type DriverTaskLocationKind = 'PICKUP' | 'DESTINATION_WAREHOUSE' | 'RECEIVER';

export interface DriverTaskLocationResponse {
  kind: DriverTaskLocationKind;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

interface WarehouseTaskLocationSource {
  code: string;
  name: string;
  address: string;
  ward: string | null;
  district: string | null;
  city: string;
  latitude: unknown;
  longitude: unknown;
}

export function toAddressTaskLocation(
  kind: Extract<DriverTaskLocationKind, 'PICKUP' | 'RECEIVER'>,
  label: string,
  address: AddressSnapshot,
): DriverTaskLocationResponse {
  return {
    kind,
    label,
    address: formatAddress([address.streetAddress, address.ward, address.district, address.city]),
    ...coordinatePair(address.latitude, address.longitude),
  };
}

export function toWarehouseTaskLocation(
  warehouse: WarehouseTaskLocationSource,
): DriverTaskLocationResponse {
  return {
    kind: 'DESTINATION_WAREHOUSE',
    label: `${warehouse.code} · ${warehouse.name}`,
    address: formatAddress([warehouse.address, warehouse.ward, warehouse.district, warehouse.city]),
    ...coordinatePair(warehouse.latitude, warehouse.longitude),
  };
}

function coordinatePair(
  latitudeValue: unknown,
  longitudeValue: unknown,
): Pick<DriverTaskLocationResponse, 'latitude' | 'longitude'> {
  const latitude = coordinate(latitudeValue, -90, 90);
  const longitude = coordinate(longitudeValue, -180, 180);
  return latitude === null || longitude === null
    ? { latitude: null, longitude: null }
    : { latitude, longitude };
}

function coordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function formatAddress(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
}
