import type { PricingConfig } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { PricingService } from './pricing.service.js';

function config(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return {
    id: 'a6844d31-044c-4fd7-a474-2bd81f706c30',
    version: 1,
    baseFee: 30_000,
    includedWeightGrams: 1_000,
    extraWeightFeePerKg: 5_000,
    codFeeBasisPoints: 50,
    distanceFee: 0,
    surcharge: 0,
    discount: 0,
    isActive: true,
    createdById: null,
    createdAt: new Date('2026-08-17T08:00:00.000Z'),
    ...overrides,
  };
}

describe('PricingService', () => {
  const service = new PricingService({} as PrismaService);

  it('includes the first kilogram in the base fee', () => {
    expect(service.calculate(1_000, 0, config())).toEqual({
      configVersion: 1,
      baseFee: 30_000,
      distanceFee: 0,
      weightFee: 0,
      codFee: 0,
      surcharge: 0,
      discount: 0,
      totalFee: 30_000,
    });
  });

  it('rounds any excess weight up to the next kilogram', () => {
    expect(service.calculate(1_001, 0, config()).weightFee).toBe(5_000);
    expect(service.calculate(2_001, 0, config()).weightFee).toBe(10_000);
  });

  it('rounds the 0.5 percent COD fee up to the nearest integer VND', () => {
    const result = service.calculate(1_000, 100_001, config());

    expect(result.codFee).toBe(501);
    expect(result.totalFee).toBe(30_501);
    expect(Number.isInteger(result.codFee)).toBe(true);
    expect(Number.isInteger(result.totalFee)).toBe(true);
  });

  it('always recalculates the total from the active configuration', () => {
    const result = service.calculate(
      2_500,
      1_000_000,
      config({ baseFee: 40_000, extraWeightFeePerKg: 6_000 }),
    );

    expect(result).toEqual({
      configVersion: 1,
      baseFee: 40_000,
      distanceFee: 0,
      weightFee: 12_000,
      codFee: 5_000,
      surcharge: 0,
      discount: 0,
      totalFee: 57_000,
    });
  });

  it('does not vary pricing when only the shipping fee payer changes', () => {
    const senderPricing = service.calculate(1_001, 500_000, config());
    const receiverPricing = service.calculate(1_001, 500_000, config());

    expect(receiverPricing).toEqual(senderPricing);
    expect(receiverPricing.totalFee).toBe(37_500);
    expect(Number.isInteger(receiverPricing.totalFee)).toBe(true);
  });
});
