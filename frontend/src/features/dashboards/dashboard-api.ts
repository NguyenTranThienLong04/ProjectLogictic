import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { DriverStatus } from '../operations/operations-types';
import type { ShipmentStatus } from '../shipments/shipment-types';

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
  createdAt: string;
}

export interface CustomerDashboard {
  generatedAt: string;
  overview: DashboardOverview;
  recentShipments: DashboardShipmentSummary[];
}

export interface DriverDashboard {
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
  assignments: { pending: number; active: number; completed: number };
  recentTasks: Array<{
    assignmentId: string;
    shipmentId: string;
    trackingCode: string;
    type: 'PICKUP' | 'DELIVERY';
    assignmentStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
    shipmentStatus: ShipmentStatus;
    assignedAt: string;
  }>;
}

export interface DispatcherDashboard {
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

async function getDashboard<T>(role: 'customer' | 'driver' | 'dispatcher'): Promise<T> {
  const response = await api.get<ApiEnvelope<T>>(`/dashboards/${role}`);
  return response.data.data;
}

export const getCustomerDashboard = () => getDashboard<CustomerDashboard>('customer');
export const getDriverDashboard = () => getDashboard<DriverDashboard>('driver');
export const getDispatcherDashboard = () => getDashboard<DispatcherDashboard>('dispatcher');
