import type { DriverStatus, ShipmentStatus } from '../../generated/prisma/client.js';

export interface DashboardOverview {
  totalShipments: number;
  pending: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
  failed: number;
  cancelled: number;
  deliverySuccessRate: number;
  averageDeliveryTimeHours: number;
  codCollected: number;
  codUnsettled: number;
}

export interface DashboardShipmentSummary {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  receiverName: string;
  deliveryCity: string;
  createdAt: Date;
}

export interface DriverDashboardTask {
  assignmentId: string;
  shipmentId: string;
  trackingCode: string;
  type: 'PICKUP' | 'DELIVERY';
  assignmentStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
  shipmentStatus: ShipmentStatus;
  assignedAt: Date;
}

export interface CustomerDashboardResponse {
  generatedAt: string;
  overview: DashboardOverview;
  recentShipments: DashboardShipmentSummary[];
}

export interface DriverDashboardResponse {
  generatedAt: string;
  overview: DashboardOverview;
  driver: {
    id: string;
    status: DriverStatus;
    isOnline: boolean;
    isAvailable: boolean;
    employeeCode: string;
    vehicleType: string;
    vehiclePlate: string;
  };
  assignments: {
    pending: number;
    active: number;
    completed: number;
  };
  recentTasks: DriverDashboardTask[];
}

export interface DispatcherDashboardResponse {
  generatedAt: string;
  overview: DashboardOverview;
  operations: {
    awaitingPickupAssignment: number;
    awaitingDeliveryAssignment: number;
    availableDrivers: number;
    busyDrivers: number;
    returnRequested: number;
    returnInTransit: number;
    damagedOrLost: number;
    disputedCod: number;
  };
  recentShipments: DashboardShipmentSummary[];
}
