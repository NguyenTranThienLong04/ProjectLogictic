import { ConflictException } from '@nestjs/common';
import {
  assertManifestWithinCapacity,
  assertValidVehicleCapacity,
  calculateManifestWeightGrams,
  resolveShipmentLoadWeightGrams,
  toManifestCapacityMetrics,
} from './line-haul-capacity.js';

function assignment(weightGrams: number, isActive = true, verifiedWeightGrams?: number) {
  return {
    isActive,
    warehouseTransfer: {
      shipment: {
        packageSnapshot: {
          weightGrams,
          ...(verifiedWeightGrams === undefined ? {} : { verifiedWeightGrams }),
        },
      },
    },
  };
}

describe('line-haul capacity policy', () => {
  it('uses verified package weight and falls back only for a legacy snapshot', () => {
    expect(resolveShipmentLoadWeightGrams({ weightGrams: 400_000 })).toBe(400_000);
    expect(
      resolveShipmentLoadWeightGrams({ weightGrams: 400_000, verifiedWeightGrams: 450_000 }),
    ).toBe(450_000);
  });

  it('counts each active association once and ignores inactive history', () => {
    expect(
      calculateManifestWeightGrams([
        assignment(400_000),
        assignment(500_000),
        assignment(900_000, false),
      ]),
    ).toBe(900_000);
  });

  it('allows below and exactly at capacity but rejects one gram over', () => {
    expect(() => assertManifestWithinCapacity(999_999, 1_000_000)).not.toThrow();
    expect(() => assertManifestWithinCapacity(1_000_000, 1_000_000)).not.toThrow();
    expect(() => assertManifestWithinCapacity(1_000_001, 1_000_000)).toThrow(ConflictException);
  });

  it.each([null, 0, -1, 1.5, 100_000_001])('rejects invalid vehicle capacity %s', (capacity) => {
    expect(() => assertValidVehicleCapacity(capacity)).toThrow(ConflictException);
  });

  it('calculates display aggregates without using percent for validation', () => {
    expect(toManifestCapacityMetrics(720_000, 1_000_000)).toEqual({
      manifestWeightGrams: 720_000,
      vehicleCapacityWeightGrams: 1_000_000,
      remainingCapacityWeightGrams: 280_000,
      capacityUtilizationPercent: 72,
    });
  });
});
