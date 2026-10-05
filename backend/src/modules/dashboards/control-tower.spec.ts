import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { controlTowerEnvironment } from '../../config/control-tower.js';
import { ControlTowerQueryDto } from './control-tower-query.dto.js';
import { controlTowerPolicy, SHIPMENT_STAGES } from './control-tower.policy.js';
import { ShipmentStatus } from '../../generated/prisma/client.js';

describe('Control Tower policy and query contract', () => {
  it('has explicit validated defaults and supports operational overrides', () => {
    const defaults = controlTowerEnvironment({});
    const policy = controlTowerPolicy(new ConfigService(defaults));
    expect(policy.durationMinutes).toEqual({
      PICKUP: 480,
      ORIGIN_DWELL: 720,
      TRANSIT: 1440,
      DESTINATION_DWELL: 720,
      DELIVERY: 480,
    });
    expect(policy.atRiskPercent).toBe(80);
    expect(controlTowerEnvironment({ SLA_PICKUP_MINUTES: '120' }).SLA_PICKUP_MINUTES).toBe('120');
    for (const value of ['0', '-1', '', 'NaN', '2.5', '525601']) {
      expect(() => controlTowerEnvironment({ SLA_PICKUP_MINUTES: value })).toThrow();
    }
    expect(() => controlTowerEnvironment({ SLA_AT_RISK_PERCENT: '100' })).toThrow();
  });

  it('maps every canonical status and keeps pickup/reassignment in one stage', () => {
    expect(Object.keys(SHIPMENT_STAGES).sort()).toEqual(Object.values(ShipmentStatus).sort());
    expect(SHIPMENT_STAGES.PICKUP_ASSIGNED).toBe(SHIPMENT_STAGES.AWAITING_PICKUP_ASSIGNMENT);
    expect(SHIPMENT_STAGES.DELIVERY_ASSIGNED).toBe(SHIPMENT_STAGES.AT_DESTINATION_WAREHOUSE);
    expect(SHIPMENT_STAGES.OUT_FOR_DELIVERY).not.toBe(SHIPMENT_STAGES.DELIVERY_ASSIGNED);
  });

  it('bounds pages, validates dates/timezone, enums and IDs', () => {
    for (const input of [
      { limit: 101 },
      { page: 0 },
      { page: 1.5 },
      { page: 100001 },
      { sort: 'id; DROP TABLE' },
      { warehouseId: 'bad' },
      { slaState: 'SAFE' },
      { entityType: 'DRIVER' },
      { status: 'DELIVERED' },
      { from: '2026-10-06' },
      { from: '2026-02-30T00:00:00Z' },
    ]) {
      expect(validateSync(plainToInstance(ControlTowerQueryDto, input)).length).toBeGreaterThan(0);
    }
    expect(
      validateSync(
        plainToInstance(ControlTowerQueryDto, {
          page: '2',
          limit: '10',
          from: '2026-10-06T00:00:00+07:00',
        }),
      ),
    ).toEqual([]);
  });
});
