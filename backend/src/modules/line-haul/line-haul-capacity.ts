import { ConflictException } from '@nestjs/common';

export const MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS = 100_000_000;

interface ManifestAssignmentLike {
  isActive: boolean;
  warehouseTransfer: {
    shipment: {
      packageSnapshot: unknown;
    };
  };
}

export interface ManifestCapacityMetrics {
  manifestWeightGrams: number;
  vehicleCapacityWeightGrams: number | null;
  remainingCapacityWeightGrams: number | null;
  capacityUtilizationPercent: number | null;
}

export function resolveShipmentLoadWeightGrams(packageSnapshot: unknown): number {
  if (!packageSnapshot || typeof packageSnapshot !== 'object' || Array.isArray(packageSnapshot)) {
    invalidShipmentWeight();
  }
  const snapshot = packageSnapshot as Record<string, unknown>;
  const verifiedWeight = snapshot.verifiedWeightGrams;
  const weight = verifiedWeight === undefined ? snapshot.weightGrams : verifiedWeight;
  if (!Number.isSafeInteger(weight) || Number(weight) <= 0) invalidShipmentWeight();
  return Number(weight);
}

export function calculateManifestWeightGrams(
  assignments: readonly ManifestAssignmentLike[],
): number {
  let total = 0;
  for (const assignment of assignments) {
    if (!assignment.isActive) continue;
    total += resolveShipmentLoadWeightGrams(assignment.warehouseTransfer.shipment.packageSnapshot);
    if (!Number.isSafeInteger(total)) {
      throw new ConflictException({
        code: 'LINE_HAUL_MANIFEST_WEIGHT_INVALID',
        message: 'Manifest weight cannot be represented safely; review its package snapshots',
      });
    }
  }
  return total;
}

export function assertValidVehicleCapacity(
  capacityWeightGrams: number | null,
): asserts capacityWeightGrams is number {
  if (
    !Number.isSafeInteger(capacityWeightGrams) ||
    Number(capacityWeightGrams) <= 0 ||
    Number(capacityWeightGrams) > MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS
  ) {
    throw new ConflictException({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_REQUIRED',
      message: 'Set a positive vehicle weight capacity before using it for an operational trip',
    });
  }
}

export function assertManifestWithinCapacity(
  manifestWeightGrams: number,
  vehicleCapacityWeightGrams: number | null,
): asserts vehicleCapacityWeightGrams is number {
  assertValidVehicleCapacity(vehicleCapacityWeightGrams);
  if (manifestWeightGrams > vehicleCapacityWeightGrams) {
    throw new ConflictException({
      code: 'LINE_HAUL_VEHICLE_CAPACITY_EXCEEDED',
      message: 'Manifest exceeds vehicle capacity; remove cargo or choose a larger vehicle',
    });
  }
}

export function toManifestCapacityMetrics(
  manifestWeightGrams: number,
  vehicleCapacityWeightGrams: number | null,
): ManifestCapacityMetrics {
  return {
    manifestWeightGrams,
    vehicleCapacityWeightGrams,
    remainingCapacityWeightGrams:
      vehicleCapacityWeightGrams === null ? null : vehicleCapacityWeightGrams - manifestWeightGrams,
    capacityUtilizationPercent:
      vehicleCapacityWeightGrams === null || vehicleCapacityWeightGrams <= 0
        ? null
        : Math.round((manifestWeightGrams / vehicleCapacityWeightGrams) * 1_000) / 10,
  };
}

function invalidShipmentWeight(): never {
  throw new ConflictException({
    code: 'LINE_HAUL_SHIPMENT_WEIGHT_INVALID',
    message: 'Shipment package snapshot must contain a positive integer load weight',
  });
}
