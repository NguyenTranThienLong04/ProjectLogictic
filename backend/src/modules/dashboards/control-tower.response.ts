export interface ControlTowerItem {
  id: string;
  entityType: 'SHIPMENT' | 'TRIP';
  code: string;
  status: string;
  stage: string;
  createdAt: string;
  stageStartedAt: string | null;
  timestampSource: 'TRACKING' | 'LIFECYCLE' | 'AUDIT' | null;
  timestampQuality: 'VALID' | 'MISSING' | 'INCONSISTENT';
  agingSeconds: number | null;
  isAging: boolean;
  deadline: string | null;
  atRiskAt: string | null;
  slaState: 'ON_TIME' | 'AT_RISK' | 'OVERDUE' | null;
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

export interface ControlTowerSummary {
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
}

export interface ControlTowerSnapshot {
  asOf: Date;
  summary: ControlTowerSummary;
  items: ControlTowerItem[];
  total: number;
}
