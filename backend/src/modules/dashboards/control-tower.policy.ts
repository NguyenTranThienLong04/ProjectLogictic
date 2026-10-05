import { ConfigService } from '@nestjs/config';
import { ShipmentStatus } from '../../generated/prisma/client.js';
import { CONTROL_TOWER_SETTINGS } from '../../config/control-tower.js';

// A projection of the existing lifecycle, never a second transition policy.
// Assignment/reassignment within a stage does not restart its SLA.
export const SHIPMENT_STAGES = {
  PENDING: 'PENDING',
  CONFIRMED: 'PICKUP',
  AWAITING_PICKUP_ASSIGNMENT: 'PICKUP',
  PICKUP_ASSIGNED: 'PICKUP',
  PICKUP_IN_PROGRESS: 'PICKUP',
  PICKED_UP: 'PICKUP',
  AT_ORIGIN_WAREHOUSE: 'ORIGIN_DWELL',
  IN_TRANSIT: 'TRANSIT',
  AT_DESTINATION_WAREHOUSE: 'DESTINATION_DWELL',
  AWAITING_DELIVERY_ASSIGNMENT: 'DESTINATION_DWELL',
  DELIVERY_ASSIGNED: 'DESTINATION_DWELL',
  OUT_FOR_DELIVERY: 'DELIVERY',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURN_IN_TRANSIT: 'RETURN_IN_TRANSIT',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  DELIVERED: 'TERMINAL',
  CANCELLED: 'TERMINAL',
  RETURNED: 'TERMINAL',
} satisfies Record<ShipmentStatus, string>;

export const EXCEPTION_STATUSES: ShipmentStatus[] = [
  'DELIVERY_FAILED',
  'RETURN_REQUESTED',
  'RETURN_IN_TRANSIT',
  'DAMAGED',
  'LOST',
];

export function controlTowerPolicy(config: ConfigService) {
  const value = (key: keyof typeof CONTROL_TOWER_SETTINGS) =>
    Number(config.get<string>(key) ?? CONTROL_TOWER_SETTINGS[key]);
  return {
    version: 'operational-v1',
    durationMinutes: {
      PICKUP: value('SLA_PICKUP_MINUTES'),
      ORIGIN_DWELL: value('SLA_ORIGIN_DWELL_MINUTES'),
      TRANSIT: value('SLA_TRANSIT_MINUTES'),
      DESTINATION_DWELL: value('SLA_DESTINATION_DWELL_MINUTES'),
      DELIVERY: value('SLA_DELIVERY_MINUTES'),
    },
    atRiskPercent: value('SLA_AT_RISK_PERCENT'),
    agingAlertMinutes: value('CONTROL_TOWER_AGING_MINUTES'),
  };
}
export type ControlTowerPolicy = ReturnType<typeof controlTowerPolicy>;
