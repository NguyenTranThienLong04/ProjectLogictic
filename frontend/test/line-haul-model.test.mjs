import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capacityGramsToKilograms,
  capacityKilogramsToGrams,
  formatCapacityWeight,
  lineHaulDriverLabel,
  lineHaulReceiveProgress,
  lineHaulVehicleLabel,
  lineHaulWarehouseLabel,
  warehouseTransferLabel,
} from '../src/features/line-haul/line-haul-model.ts';

test('renders searchable line-haul entities with readable business identifiers', () => {
  assert.equal(
    lineHaulDriverLabel({ fullName: 'Nguyễn Văn An', employeeCode: 'DRV-018' }),
    'Nguyễn Văn An — DRV-018',
  );
  assert.equal(
    lineHaulVehicleLabel({
      vehicleCode: 'LH-TRUCK-01',
      licensePlate: '51C-12345',
      capacityWeightGrams: 8_000_000,
    }),
    'LH-TRUCK-01 — 51C-12345 — 8.000 kg',
  );
  assert.equal(
    lineHaulWarehouseLabel({
      name: 'Kho Bình Tân',
      address: '123 Quốc lộ 1A',
      city: 'Hồ Chí Minh',
    }),
    'Kho Bình Tân — 123 Quốc lộ 1A, Hồ Chí Minh',
  );
  assert.equal(
    warehouseTransferLabel({
      transferCode: 'TRF-240901',
      loadWeightGrams: 450_000,
      shipment: { trackingCode: 'SHP-240901' },
    }),
    'TRF-240901 — SHP-240901 — 450 kg',
  );
});

test('formats optional line-haul capacity for operators', () => {
  assert.equal(formatCapacityWeight(null), 'Chưa cấu hình');
  assert.equal(formatCapacityWeight(8_500_000), '8.500 kg');
  assert.equal(formatCapacityWeight(200_001), '200,001 kg');
  assert.equal(capacityKilogramsToGrams('1000,125'), 1_000_125);
  assert.equal(capacityGramsToKilograms(1_000_125), '1000,125');
});

test('derives bounded destination receive progress from backend manifest counters', () => {
  assert.equal(lineHaulReceiveProgress({ totalTransfers: 0, receivedTransfers: 0 }), 0);
  assert.equal(lineHaulReceiveProgress({ totalTransfers: 4, receivedTransfers: 1 }), 25);
  assert.equal(lineHaulReceiveProgress({ totalTransfers: 2, receivedTransfers: 3 }), 100);
});
