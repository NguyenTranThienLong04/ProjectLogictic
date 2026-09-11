import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';

export type AnalyticsGranularity = 'day' | 'week' | 'month';

export interface AnalyticsFilters {
  from: string;
  to: string;
  warehouseId: string;
  driverId: string;
  granularity: AnalyticsGranularity;
}

interface FilterOption {
  id: string;
  label: string;
}

export interface AnalyticsDashboard {
  generatedAt: string;
  filters: Omit<AnalyticsFilters, 'warehouseId' | 'driverId'> & {
    warehouseId: string | null;
    driverId: string | null;
  };
  filterOptions: {
    warehouses: FilterOption[];
    drivers: FilterOption[];
  };
  overview: {
    totalShipments: number;
    pending: number;
    inTransit: number;
    outForDelivery: number;
    delivered: number;
    failed: number;
    cancelled: number;
    averageDeliveryTimeHours: number;
    deliverySuccessRate: number;
  };
  deliveryPerformance: {
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    successRate: number;
    firstAttemptSuccessRate: number;
    averageAttemptDurationHours: number;
  };
  statusBreakdown: Array<{ status: string; count: number }>;
  shipmentTrend: Array<{
    period: string;
    created: number;
    delivered: number;
    failed: number;
  }>;
  driverPerformance: Array<{
    driverId: string;
    driverName: string;
    employeeCode: string;
    totalAttempts: number;
    delivered: number;
    failed: number;
    successRate: number;
    averageAttemptDurationHours: number;
  }>;
  warehouseStats: Array<{
    warehouseId: string;
    code: string;
    name: string;
    inboundShipments: number;
    outboundShipments: number;
    currentInventory: number;
    transfersDispatched: number;
    transfersReceived: number;
    deliveredShipments: number;
  }>;
  failedDeliveryStats: {
    totalFailures: number;
    affectedShipments: number;
    byReason: Array<{
      reason: string;
      count: number;
      affectedShipments: number;
      percentage: number;
    }>;
  };
  codStats: {
    transactionCount: number;
    expectedAmount: number;
    collectedAmount: number;
    remittedAmount: number;
    settledAmount: number;
    unsettledAmount: number;
    disputedAmount: number;
  };
}

export async function getAnalytics(filters: AnalyticsFilters): Promise<AnalyticsDashboard> {
  const response = await api.get<ApiEnvelope<AnalyticsDashboard>>('/admin/analytics', {
    params: {
      from: filters.from,
      to: filters.to,
      warehouseId: filters.warehouseId || undefined,
      driverId: filters.driverId || undefined,
      granularity: filters.granularity,
    },
  });
  return response.data.data;
}
