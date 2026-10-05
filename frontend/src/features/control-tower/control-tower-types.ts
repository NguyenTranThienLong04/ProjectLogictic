export type SlaState = 'ON_TIME' | 'AT_RISK' | 'OVERDUE';
export type TowerSort = 'PRIORITY' | 'AGING_DESC' | 'DEADLINE_ASC' | 'CREATED_DESC' | 'CODE_ASC';
export type OperationsRole = 'admin' | 'dispatcher';
export interface TowerItem {
  id: string;
  entityType: 'SHIPMENT' | 'TRIP';
  code: string;
  status: string;
  stage: string;
  createdAt: string;
  stageStartedAt: string | null;
  agingSeconds: number | null;
  timestampSource: 'TRACKING' | 'LIFECYCLE' | 'AUDIT' | null;
  timestampQuality: 'VALID' | 'MISSING' | 'INCONSISTENT';
  deadline: string | null;
  atRiskAt: string | null;
  slaState: SlaState | null;
  isAging: boolean;
  exception: string | null;
  priority: number;
  originWarehouseId: string | null;
  destinationWarehouseId: string | null;
  currentWarehouseId: string | null;
  originWarehouseCode: string | null;
  destinationWarehouseCode: string | null;
  currentWarehouseCode: string | null;
  transferId: string | null;
  transferCode: string | null;
  transferWarehouseId: string | null;
  tripId: string | null;
  tripCode: string | null;
}
export interface TowerPolicy {
  version: string;
  durationMinutes: Record<string, number>;
  atRiskPercent: number;
  agingAlertMinutes: number;
}
export interface TowerFilters {
  statuses: string[];
  stages: string[];
  slaStates: string[];
  policy: TowerPolicy;
}
export interface TowerSnapshot {
  asOf: string;
  policy: TowerPolicy;
  items: TowerItem[];
  summary: {
    activeShipments: number;
    pickup: number;
    originWarehouse: number;
    inTransit: number;
    destinationWarehouse: number;
    outForDelivery: number;
    exceptions: number;
    overdue: number;
    atRisk: number;
    aging: number;
    unavailableSla: number;
    activeTrips: number;
    overdueTrips: number;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
