import type { RouteMetricMode } from '../routing/route-metrics.service.js';

export const LINE_HAUL_PLANNING_ALGORITHM_VERSION = 'G3C3_RULES_V1';
export const LINE_HAUL_PLANNING_SLOT_MINUTES = 30;
export const LINE_HAUL_PLANNING_ROUTE_BUFFER_MINUTES = 30;
export const LINE_HAUL_PLANNING_MIN_DURATION_MINUTES = 60;
export const LINE_HAUL_PLANNING_FALLBACK_DURATION_MINUTES = 180;
export const LINE_HAUL_PLANNING_MAX_HORIZON_DAYS = 7;
export const LINE_HAUL_PLANNING_MAX_TRANSFERS = 100;
export const LINE_HAUL_PLANNING_MAX_DRIVERS = 50;
export const LINE_HAUL_PLANNING_MAX_VEHICLES = 50;

export interface PlanningDriver {
  id: string;
  employeeCode: string;
  fullName: string;
  operatingWarehouseId: string | null;
}

export interface PlanningVehicle {
  id: string;
  vehicleCode: string;
  licensePlate: string;
  vehicleType: string;
  capacityWeightGrams: number;
}

export interface PlanningTransfer {
  id: string;
  transferCode: string;
  trackingCode: string;
  loadWeightGrams: number;
  createdAt: Date;
}

export interface PlanningConflict {
  driverId: string;
  vehicleId: string;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
}

export interface PlanningRouteMetric {
  distanceMeters: number;
  durationSeconds: number | null;
  mode: RouteMetricMode;
  calculatedAt: Date;
}

export type PlanningReasonCode =
  | 'CAPACITY_UTILIZATION'
  | 'TRANSFER_CONSOLIDATION'
  | 'EARLY_DEPARTURE'
  | 'ROUTE_METRIC_QUALITY'
  | 'DRIVER_ORIGIN_ALIGNMENT';

export interface PlanningScoreReason {
  code: PlanningReasonCode;
  label: string;
  points: number;
}

export interface LineHaulPlanningRecommendation {
  rank: number;
  score: number;
  originWarehouseId: string;
  destinationWarehouseId: string;
  driver: PlanningDriver;
  vehicle: PlanningVehicle;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  manifestWeightGrams: number;
  capacityUtilizationPercent: number;
  remainingCapacityWeightGrams: number;
  transfers: PlanningTransfer[];
  route: PlanningRouteMetric | null;
  reasons: PlanningScoreReason[];
}

interface ScorePlanningInput {
  originWarehouseId: string;
  destinationWarehouseId: string;
  earliestStartAt: Date;
  latestEndAt: Date;
  drivers: PlanningDriver[];
  vehicles: PlanningVehicle[];
  transfers: PlanningTransfer[];
  conflicts: PlanningConflict[];
  route: PlanningRouteMetric | null;
  maxRecommendations: number;
}

interface DepartureWindow {
  start: Date;
  end: Date;
  slotIndex: number;
}

export function resolvePlanningDurationMinutes(durationSeconds: number | null): number {
  if (durationSeconds === null) return LINE_HAUL_PLANNING_FALLBACK_DURATION_MINUTES;
  const routeWithBufferMinutes = durationSeconds / 60 + LINE_HAUL_PLANNING_ROUTE_BUFFER_MINUTES;
  return Math.max(
    LINE_HAUL_PLANNING_MIN_DURATION_MINUTES,
    Math.ceil(routeWithBufferMinutes / LINE_HAUL_PLANNING_SLOT_MINUTES) *
      LINE_HAUL_PLANNING_SLOT_MINUTES,
  );
}

export function buildDepartureWindows(
  earliestStartAt: Date,
  latestEndAt: Date,
  durationMinutes: number,
): DepartureWindow[] {
  const windows: DepartureWindow[] = [];
  const durationMs = durationMinutes * 60_000;
  const stepMs = LINE_HAUL_PLANNING_SLOT_MINUTES * 60_000;
  for (
    let startMs = earliestStartAt.getTime(), slotIndex = 0;
    startMs + durationMs <= latestEndAt.getTime();
    startMs += stepMs, slotIndex += 1
  ) {
    windows.push({
      start: new Date(startMs),
      end: new Date(startMs + durationMs),
      slotIndex,
    });
  }
  return windows;
}

export function selectTransfersForCapacity(
  transfers: readonly PlanningTransfer[],
  capacityWeightGrams: number,
): PlanningTransfer[] {
  const ordered = [...transfers].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
  const selected: PlanningTransfer[] = [];
  let totalWeightGrams = 0;
  for (const transfer of ordered) {
    if (totalWeightGrams + transfer.loadWeightGrams > capacityWeightGrams) continue;
    selected.push(transfer);
    totalWeightGrams += transfer.loadWeightGrams;
  }
  return selected;
}

export function scoreLineHaulPlanning(input: ScorePlanningInput): LineHaulPlanningRecommendation[] {
  if (input.transfers.length === 0) return [];
  const durationMinutes = resolvePlanningDurationMinutes(input.route?.durationSeconds ?? null);
  const windows = buildDepartureWindows(input.earliestStartAt, input.latestEndAt, durationMinutes);
  const recommendations: Omit<LineHaulPlanningRecommendation, 'rank'>[] = [];
  const drivers = [...input.drivers].sort(
    (left, right) =>
      left.employeeCode.localeCompare(right.employeeCode) || left.id.localeCompare(right.id),
  );
  const vehicles = [...input.vehicles].sort(
    (left, right) =>
      left.vehicleCode.localeCompare(right.vehicleCode) || left.id.localeCompare(right.id),
  );

  for (const vehicle of vehicles) {
    const transfers = selectTransfersForCapacity(input.transfers, vehicle.capacityWeightGrams);
    if (transfers.length === 0) continue;
    const manifestWeightGrams = transfers.reduce(
      (sum, transfer) => sum + transfer.loadWeightGrams,
      0,
    );
    const capacityUtilizationPercent =
      Math.round((manifestWeightGrams / vehicle.capacityWeightGrams) * 1_000) / 10;

    for (const window of windows) {
      if (hasVehicleConflict(input.conflicts, vehicle.id, window)) continue;
      for (const driver of drivers) {
        if (hasDriverConflict(input.conflicts, driver.id, window)) continue;
        const reasons = scoreReasons(
          capacityUtilizationPercent,
          transfers.length,
          window.slotIndex,
          input.route?.mode ?? null,
          driver.operatingWarehouseId === input.originWarehouseId,
        );
        const candidate = {
          score: reasons.reduce((sum, reason) => sum + reason.points, 0),
          originWarehouseId: input.originWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          driver,
          vehicle,
          scheduledStartAt: window.start,
          scheduledEndAt: window.end,
          manifestWeightGrams,
          capacityUtilizationPercent,
          remainingCapacityWeightGrams: vehicle.capacityWeightGrams - manifestWeightGrams,
          transfers,
          route: input.route,
          reasons,
        };
        recommendations.push(candidate);
        recommendations.sort(compareRecommendations);
        if (recommendations.length > input.maxRecommendations) recommendations.pop();
      }
    }
  }

  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    rank: index + 1,
  }));
}

function compareRecommendations(
  left: Omit<LineHaulPlanningRecommendation, 'rank'>,
  right: Omit<LineHaulPlanningRecommendation, 'rank'>,
): number {
  return (
    right.score - left.score ||
    right.capacityUtilizationPercent - left.capacityUtilizationPercent ||
    right.transfers.length - left.transfers.length ||
    left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime() ||
    left.driver.employeeCode.localeCompare(right.driver.employeeCode) ||
    left.vehicle.vehicleCode.localeCompare(right.vehicle.vehicleCode) ||
    left.driver.id.localeCompare(right.driver.id) ||
    left.vehicle.id.localeCompare(right.vehicle.id)
  );
}

function scoreReasons(
  utilizationPercent: number,
  transferCount: number,
  slotIndex: number,
  metricMode: RouteMetricMode | null,
  driverMatchesOrigin: boolean,
): PlanningScoreReason[] {
  const capacityPoints = Math.min(45, Math.round(utilizationPercent * 0.45));
  const consolidationPoints = Math.min(20, transferCount * 4);
  const earlyDeparturePoints = Math.max(0, 20 - slotIndex * 2);
  const routePoints =
    metricMode === 'ROAD_ROUTE' ? 10 : metricMode === 'HAVERSINE_FALLBACK' ? 5 : 0;
  const originPoints = driverMatchesOrigin ? 5 : 0;
  return [
    {
      code: 'CAPACITY_UTILIZATION',
      label: `Mức sử dụng sức tải ${utilizationPercent.toLocaleString('vi-VN')}%`,
      points: capacityPoints,
    },
    {
      code: 'TRANSFER_CONSOLIDATION',
      label: `Gom ${transferCount.toLocaleString('vi-VN')} transfer cùng tuyến`,
      points: consolidationPoints,
    },
    {
      code: 'EARLY_DEPARTURE',
      label: slotIndex === 0 ? 'Window khởi hành sớm nhất' : 'Window còn sớm trong khoảng yêu cầu',
      points: earlyDeparturePoints,
    },
    {
      code: 'ROUTE_METRIC_QUALITY',
      label:
        metricMode === 'ROAD_ROUTE'
          ? 'Có distance và duration đường bộ'
          : metricMode === 'HAVERSINE_FALLBACK'
            ? 'Có khoảng cách ước tính; duration dùng policy fallback'
            : 'Thiếu tọa độ tuyến; duration dùng policy fallback',
      points: routePoints,
    },
    {
      code: 'DRIVER_ORIGIN_ALIGNMENT',
      label: driverMatchesOrigin
        ? 'Kho vận hành của tài xế khớp kho xuất phát'
        : 'Tài xế đủ điều kiện LINE_HAUL nhưng không có ưu tiên kho xuất phát',
      points: originPoints,
    },
  ];
}

function hasDriverConflict(
  conflicts: readonly PlanningConflict[],
  driverId: string,
  window: DepartureWindow,
): boolean {
  return conflicts.some((conflict) => conflict.driverId === driverId && overlaps(conflict, window));
}

function hasVehicleConflict(
  conflicts: readonly PlanningConflict[],
  vehicleId: string,
  window: DepartureWindow,
): boolean {
  return conflicts.some(
    (conflict) => conflict.vehicleId === vehicleId && overlaps(conflict, window),
  );
}

function overlaps(conflict: PlanningConflict, window: DepartureWindow): boolean {
  if (!conflict.scheduledStartAt || !conflict.scheduledEndAt) return true;
  return (
    window.start.getTime() < conflict.scheduledEndAt.getTime() &&
    window.end.getTime() > conflict.scheduledStartAt.getTime()
  );
}
