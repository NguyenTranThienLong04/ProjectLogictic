import type { DriverCapability, DriverStatus, Prisma } from '../../generated/prisma/client.js';

export interface DriverResponse {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  vehicleType: string;
  vehiclePlate: string;
  capabilities: DriverCapability[];
  status: DriverStatus;
  isOnline: boolean;
  isAvailable: boolean;
  operatingWarehouse: {
    id: string;
    code: string;
    name: string;
    city: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedDriversResponse {
  items: DriverResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type DriverWithUser = Prisma.DriverProfileGetPayload<{
  include: { user: true; operatingWarehouse: true };
}>;

export function toDriverResponse(profile: DriverWithUser): DriverResponse {
  return {
    id: profile.id,
    userId: profile.userId,
    fullName: profile.user.fullName,
    email: profile.user.email,
    employeeCode: profile.employeeCode,
    vehicleType: profile.vehicleType,
    vehiclePlate: profile.vehiclePlate,
    capabilities: profile.capabilities,
    status: profile.status,
    isOnline: profile.isOnline,
    isAvailable: profile.isAvailable,
    operatingWarehouse: profile.operatingWarehouse
      ? {
          id: profile.operatingWarehouse.id,
          code: profile.operatingWarehouse.code,
          name: profile.operatingWarehouse.name,
          city: profile.operatingWarehouse.city,
        }
      : null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
