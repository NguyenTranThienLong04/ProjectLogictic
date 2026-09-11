import type { DriverTaskLocation } from '../locations/location-types';
import type { RouteMetricMode } from '../../utils/route-metric';
import type {
  AddressSnapshot,
  PackageSnapshot,
  ShipmentStatus,
  ShippingFeeTransaction,
  ShippingFeePayer,
} from '../shipments/shipment-types';

export type DriverStatus = 'OFFLINE' | 'AVAILABLE' | 'BUSY' | 'SUSPENDED';
export type DriverCapability = 'PICKUP' | 'DELIVERY' | 'LINE_HAUL';
export type AssignmentStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

export interface DriverProfile {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  vehicleType: string;
  vehiclePlate: string;
  status: DriverStatus;
  capabilities: DriverCapability[];
  isOnline: boolean;
  isAvailable: boolean;
  operatingWarehouse: WarehouseReference | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalShipment {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  version: number;
  customer: { fullName: string; phone: string | null };
  sender: { fullName: string; email?: string; phone: string | null };
  receiver: { fullName: string; phone: string | null };
  pickup: AddressSnapshot;
  delivery: AddressSnapshot;
  package: PackageSnapshot;
  totalFee: number;
  codAmount: number;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeeTransaction;
  originWarehouse: WarehouseReference | null;
  destinationWarehouse: WarehouseReference | null;
  currentWarehouse: WarehouseReference | null;
  returnWarehouse: WarehouseReference | null;
  createdAt: string;
  confirmedAt: string | null;
  assignment: {
    id: string;
    status: AssignmentStatus;
    driverId: string;
    driverName: string;
    employeeCode: string;
    assignedAt: string;
  } | null;
  pickupAssignment: OperationalAssignmentSummary | null;
  deliveryAssignment: OperationalAssignmentSummary | null;
  latestDeliveryAttempt: {
    id: string;
    attemptNumber: number;
    status: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
    failureReason: DeliveryFailureReason | null;
    failureNote: string | null;
    completedAt: string | null;
    proof: {
      id: string;
      receiverName: string | null;
      note: string | null;
      capturedAt: string;
    } | null;
  } | null;
}

export interface WarehouseReference {
  id: string;
  code: string;
  name: string;
}

export interface AssignmentCandidates {
  assignmentType: 'PICKUP' | 'DELIVERY';
  distanceMethod: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK' | 'MIXED';
  distanceNotice: string;
  target: { label: string; city: string };
  candidates: Array<{
    id: string;
    fullName: string;
    employeeCode: string;
    vehicleType: string;
    vehiclePlate: string;
    operatingWarehouse: WarehouseReference & { city: string };
    estimatedDistanceKm: number;
    distanceMeters: number;
    durationSeconds: number | null;
    metricMode: RouteMetricMode;
    routeProvider: string;
    metricCalculatedAt: string;
    locationUpdatedAt: string;
  }>;
  exclusions: {
    missingCapability: number;
    noOperatingWarehouse: number;
    outsideOperatingArea: number;
    noCurrentLocation: number;
  };
}

interface OperationalAssignmentSummary {
  id: string;
  status: AssignmentStatus;
  driverId: string;
  driverName: string;
  employeeCode: string;
  assignedAt: string;
}

export interface Assignment {
  id: string;
  shipmentId: string;
  trackingCode: string;
  shipmentStatus: ShipmentStatus;
  status: AssignmentStatus;
  type: 'PICKUP' | 'DELIVERY';
  driver: {
    id: string;
    fullName: string;
    employeeCode: string;
    vehicleType: string;
    vehiclePlate: string;
  };
  pickup: OperationalShipment['pickup'];
  taskLocation: DriverTaskLocation;
  receiver: { fullName: string; phone: string | null };
  shippingFee: ShippingFeeTransaction;
  availableActions: { collectShippingFee: boolean };
  assignedAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reason: string | null;
  proof: {
    id: string;
    shipmentId: string;
    type: 'PICKUP' | 'DELIVERY';
    note: string | null;
    fileUrl: string | null;
    capturedAt: string;
    createdById: string;
  } | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type DeliveryFailureReason =
  | 'RECIPIENT_UNAVAILABLE'
  | 'RECIPIENT_REJECTED'
  | 'WRONG_ADDRESS'
  | 'INVALID_PHONE'
  | 'ADDRESS_NOT_FOUND'
  | 'VEHICLE_ISSUE'
  | 'WEATHER'
  | 'OTHER';

export interface DeliveryAssignment {
  id: string;
  shipmentId: string;
  trackingCode: string;
  type: 'DELIVERY';
  status: AssignmentStatus;
  assignedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  shipmentStatus: ShipmentStatus;
  receiver: { fullName: string; phone: string | null };
  delivery: OperationalShipment['delivery'];
  taskLocation: DriverTaskLocation | null;
  codAmount: number;
  shippingFee: ShippingFeeTransaction;
  availableActions: { collectShippingFee: boolean };
  driver: { id: string; fullName: string; employeeCode: string };
  attempt: {
    id: string;
    attemptNumber: number;
    status: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
    failureReason: DeliveryFailureReason | null;
    failureNote: string | null;
    proof: {
      id: string;
      capturedAt: string;
      receiverName: string | null;
      note: string | null;
      fileUrl?: string | null;
    } | null;
  } | null;
}

export type OperationalShipmentView =
  'PICKUP' | 'DELIVERY' | 'FAILED' | 'RETURNS' | 'EXCEPTIONS' | 'ALL';

export type DriverDeliveryListView = 'ACTIVE' | 'HISTORY' | 'ALL';
