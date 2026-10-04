import { ConfigService } from '@nestjs/config';
import { WarehouseTransferFlowPolicy } from './warehouse-transfer-flow.policy.js';
import { parseLineHaulEnforcementFrom } from '../../config/line-haul-enforcement.js';
import { WarehouseTransferStatus } from '../../generated/prisma/client.js';

describe('Warehouse transfer cutover', () => {
  const cutover = '2026-01-01T00:00:00.000Z';
  const strict = new WarehouseTransferFlowPolicy(
    new ConfigService({ LINE_HAUL_ENFORCEMENT_FROM: cutover }),
  );

  it('defaults to compatibility and accepts only explicit valid UTC cutovers', () => {
    const compatibility = new WarehouseTransferFlowPolicy(
      new ConfigService({ LINE_HAUL_ENFORCEMENT_FROM: '' }),
    );
    expect(compatibility.isEnforced()).toBe(false);
    expect(() => compatibility.assertStandaloneDispatch()).not.toThrow();
    expect(() => compatibility.assertStandaloneReceive(null)).not.toThrow();
    expect(parseLineHaulEnforcementFrom('2026-01-01T00:00:00Z')?.toISOString()).toBe(cutover);
    expect(parseLineHaulEnforcementFrom(cutover)?.toISOString()).toBe(cutover);
    for (const invalid of [
      'true',
      '2026-01-01',
      '2026-02-30T00:00:00Z',
      '2026-01-01T07:00:00+07:00',
    ]) {
      expect(() => parseLineHaulEnforcementFrom(invalid)).toThrow('UTC');
    }
  });

  it('blocks new standalone departure exactly at the cutover, including old pending transfers', () => {
    expect(() =>
      strict.assertStandaloneDispatch(new Date('2025-12-31T23:59:59.999Z')),
    ).not.toThrow();
    expect(() => strict.assertStandaloneDispatch(new Date(cutover))).toThrow();
    expect(
      strict.describe({ status: WarehouseTransferStatus.PENDING, dispatchedAt: null }),
    ).toMatchObject({
      lineHaulRequired: true,
      canStandaloneDispatch: false,
      canReceive: false,
    });
  });

  it('grandfathers only departures strictly before the stable cutover', () => {
    const legacy = new Date('2025-12-31T23:59:59.999Z');
    expect(() => strict.assertStandaloneReceive(legacy)).not.toThrow();
    expect(() => strict.assertStandaloneReceive(new Date(cutover))).toThrow();
    expect(() => strict.assertStandaloneReceive(null)).toThrow();
    expect(
      strict.describe({ status: WarehouseTransferStatus.IN_TRANSIT, dispatchedAt: legacy }),
    ).toMatchObject({
      legacyStandalone: true,
      canReceive: true,
    });
  });
});
