import type { AddressSnapshot, PackageSnapshot, ShipmentStatus } from '../shipments/shipment-types';

export type WarehouseTransferStatus = 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface WarehouseCatalogueItem {
  id: string;
  code: string;
  name: string;
  address: string;
}

export interface Warehouse extends WarehouseCatalogueItem {
  ward: string | null;
  district: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  staffCount?: number;
  activeShipmentsCount?: number;
}

export interface WarehouseStaffProfile {
  id: string;
  userId: string;
  warehouseId: string;
  staffCode: string;
  isActive: boolean;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
  };
  warehouse: {
    id: string;
    code: string;
    name: string;
    city: string;
  };
}

export interface WarehouseTransfer {
  id: string;
  transferCode: string;
  shipmentId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: WarehouseTransferStatus;
  note: string | null;
  clientRequestId: string;
  createdById: string;
  dispatchedById: string | null;
  dispatchedAt: string | null;
  receivedById: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shipment?: {
    id: string;
    trackingCode: string;
    status: ShipmentStatus;
    totalFee: number;
    codAmount: number;
    senderSnapshot: ContactSnapshot;
    receiverSnapshot: ContactSnapshot;
  };
  fromWarehouse?: {
    id: string;
    code: string;
    name: string;
    city: string;
  };
  toWarehouse?: {
    id: string;
    code: string;
    name: string;
    city: string;
  };
  dispatchedBy?: {
    id: string;
    fullName: string;
  } | null;
  receivedBy?: {
    id: string;
    fullName: string;
  } | null;
  lineHaulTrip?: {
    id: string;
    tripCode: string;
    status: 'PLANNED' | 'READY' | 'IN_TRANSIT' | 'ARRIVED' | 'CANCELLED';
  } | null;
}

export interface InboundQueue {
  incomingTransfers: WarehouseTransfer[];
  pickedUpShipments: WarehouseShipment[];
}

export interface ContactSnapshot {
  fullName: string;
  email?: string;
  phone?: string | null;
}

export interface WarehousePackageSnapshot extends PackageSnapshot {
  verifiedWeightGrams?: number;
  verifiedDimensions?: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  verifiedAt?: string;
  verifiedByStaffId?: string;
}

export interface WarehouseShipment {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  totalFee: number;
  codAmount: number;
  originWarehouseId: string | null;
  destinationWarehouseId: string | null;
  currentWarehouseId: string | null;
  senderSnapshot: ContactSnapshot;
  receiverSnapshot: ContactSnapshot;
  pickupSnapshot: AddressSnapshot;
  deliverySnapshot: AddressSnapshot;
  packageSnapshot: WarehousePackageSnapshot;
  originWarehouse?: { id: string; code: string; name: string; city: string } | null;
  destinationWarehouse?: { id: string; code: string; name: string; city: string } | null;
  currentWarehouse?: { id: string; code: string; name: string; city: string } | null;
}

export interface PaginatedWarehouseExceptions {
  items: WarehouseShipment[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
