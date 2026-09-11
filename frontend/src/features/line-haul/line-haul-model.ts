import type {
  EligibleLineHaulDriver,
  EligibleWarehouseTransfer,
  LineHaulVehicle,
  LineHaulWarehouse,
} from './line-haul-types';

export function lineHaulDriverLabel(driver: EligibleLineHaulDriver): string {
  return `${driver.fullName} — ${driver.employeeCode}`;
}

export function lineHaulVehicleLabel(vehicle: LineHaulVehicle): string {
  return `${vehicle.vehicleCode} — ${vehicle.licensePlate} — ${formatCapacityWeight(vehicle.capacityWeightGrams)}`;
}

export function lineHaulWarehouseLabel(warehouse: LineHaulWarehouse): string {
  return `${warehouse.name} — ${warehouse.address}, ${warehouse.city}`;
}

export function warehouseTransferLabel(transfer: EligibleWarehouseTransfer): string {
  return `${transfer.transferCode} — ${transfer.shipment.trackingCode} — ${formatCapacityWeight(transfer.loadWeightGrams)}`;
}

export function formatCapacityWeight(capacityWeightGrams: number | null): string {
  if (capacityWeightGrams === null) return 'Chưa cấu hình';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(
    capacityWeightGrams / 1_000,
  )} kg`;
}

export function capacityKilogramsToGrams(value: string): number {
  return Math.round(Number(value.replace(',', '.')) * 1_000);
}

export function capacityGramsToKilograms(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3, useGrouping: false }).format(
    value / 1_000,
  );
}

export function lineHaulReceiveProgress(manifest: {
  totalTransfers: number;
  receivedTransfers: number;
}): number {
  if (manifest.totalTransfers <= 0) return 0;
  return Math.min(100, Math.max(0, (manifest.receivedTransfers / manifest.totalTransfers) * 100));
}
