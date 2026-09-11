import type {
  Prisma,
  ShipmentStatus,
  Warehouse,
  WarehouseStaffProfile,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';

export const warehouseShipmentInclude = {
  customer: { select: { fullName: true, phone: true } },
  originWarehouse: { select: { id: true, code: true, name: true, city: true } },
  destinationWarehouse: { select: { id: true, code: true, name: true, city: true } },
  currentWarehouse: { select: { id: true, code: true, name: true, city: true } },
  driverAssignments: {
    where: { type: 'PICKUP', status: 'COMPLETED' },
    include: { driver: { include: { user: true } } },
    orderBy: { completedAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ShipmentInclude;

export type WarehouseShipment = Prisma.ShipmentGetPayload<{
  include: typeof warehouseShipmentInclude;
}>;

export const warehouseTransferResponseInclude = {
  shipment: true,
  fromWarehouse: true,
  toWarehouse: true,
  dispatchedBy: true,
  receivedBy: true,
  lineHaulTripAssignments: {
    where: { isActive: true },
    include: { trip: { select: { id: true, tripCode: true, status: true } } },
    take: 1,
  },
} satisfies Prisma.WarehouseTransferInclude;

export type WarehouseTransferResponseEntity = Prisma.WarehouseTransferGetPayload<{
  include: typeof warehouseTransferResponseInclude;
}>;

export interface WarehouseResponse {
  id: string;
  code: string;
  name: string;
  address: string;
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

export interface WarehouseCatalogResponse {
  id: string;
  code: string;
  name: string;
  address: string;
}

export function toWarehouseCatalogResponse(warehouse: Warehouse): WarehouseCatalogResponse {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
  };
}

export function toWarehouseResponse(
  warehouse: Warehouse & {
    _count?: {
      staffProfiles?: number;
      currentShipments?: number;
    };
  },
): WarehouseResponse {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    ward: warehouse.ward,
    district: warehouse.district,
    city: warehouse.city,
    latitude: warehouse.latitude ? Number(warehouse.latitude) : null,
    longitude: warehouse.longitude ? Number(warehouse.longitude) : null,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
    staffCount: warehouse._count?.staffProfiles,
    activeShipmentsCount: warehouse._count?.currentShipments,
  };
}

export interface WarehouseStaffProfileResponse {
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

export function toWarehouseStaffProfileResponse(
  profile: WarehouseStaffProfile & {
    user: { id: string; fullName: string; email: string; phone: string | null };
    warehouse: { id: string; code: string; name: string; city: string };
  },
): WarehouseStaffProfileResponse {
  return {
    id: profile.id,
    userId: profile.userId,
    warehouseId: profile.warehouseId,
    staffCode: profile.staffCode,
    isActive: profile.isActive,
    createdAt: profile.createdAt.toISOString(),
    user: {
      id: profile.user.id,
      fullName: profile.user.fullName,
      email: profile.user.email,
      phone: profile.user.phone,
    },
    warehouse: {
      id: profile.warehouse.id,
      code: profile.warehouse.code,
      name: profile.warehouse.name,
      city: profile.warehouse.city,
    },
  };
}

export interface WarehouseTransferResponse {
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
    senderSnapshot: Prisma.JsonValue;
    receiverSnapshot: Prisma.JsonValue;
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
    status: string;
  } | null;
}

export function toWarehouseTransferResponse(
  transfer: WarehouseTransferResponseEntity,
): WarehouseTransferResponse {
  return {
    id: transfer.id,
    transferCode: transfer.transferCode,
    shipmentId: transfer.shipmentId,
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    status: transfer.status,
    note: transfer.note,
    clientRequestId: transfer.clientRequestId,
    createdById: transfer.createdById,
    dispatchedById: transfer.dispatchedById,
    dispatchedAt: transfer.dispatchedAt ? transfer.dispatchedAt.toISOString() : null,
    receivedById: transfer.receivedById,
    receivedAt: transfer.receivedAt ? transfer.receivedAt.toISOString() : null,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
    shipment: transfer.shipment
      ? {
          id: transfer.shipment.id,
          trackingCode: transfer.shipment.trackingCode,
          status: transfer.shipment.status,
          totalFee: transfer.shipment.totalFee,
          codAmount: transfer.shipment.codAmount,
          senderSnapshot: transfer.shipment.senderSnapshot,
          receiverSnapshot: transfer.shipment.receiverSnapshot,
        }
      : undefined,
    fromWarehouse: transfer.fromWarehouse
      ? {
          id: transfer.fromWarehouse.id,
          code: transfer.fromWarehouse.code,
          name: transfer.fromWarehouse.name,
          city: transfer.fromWarehouse.city,
        }
      : undefined,
    toWarehouse: transfer.toWarehouse
      ? {
          id: transfer.toWarehouse.id,
          code: transfer.toWarehouse.code,
          name: transfer.toWarehouse.name,
          city: transfer.toWarehouse.city,
        }
      : undefined,
    dispatchedBy: transfer.dispatchedBy
      ? {
          id: transfer.dispatchedBy.id,
          fullName: transfer.dispatchedBy.fullName,
        }
      : null,
    receivedBy: transfer.receivedBy
      ? {
          id: transfer.receivedBy.id,
          fullName: transfer.receivedBy.fullName,
        }
      : null,
    lineHaulTrip: transfer.lineHaulTripAssignments?.[0]?.trip ?? null,
  };
}
