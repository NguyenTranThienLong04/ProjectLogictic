/** Operational defaults, not contractual/customer promises. Durations are elapsed minutes, 24/7. */
export const CONTROL_TOWER_SETTINGS = {
  SLA_PICKUP_MINUTES: 480,
  SLA_ORIGIN_DWELL_MINUTES: 720,
  SLA_TRANSIT_MINUTES: 1440,
  SLA_DESTINATION_DWELL_MINUTES: 720,
  SLA_DELIVERY_MINUTES: 480,
  SLA_AT_RISK_PERCENT: 80,
  CONTROL_TOWER_AGING_MINUTES: 360,
} as const;

export function controlTowerEnvironment(environment: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(CONTROL_TOWER_SETTINGS).map(([key, fallback]) => {
      const value = Number(environment[key] ?? fallback);
      const maximum = key === 'SLA_AT_RISK_PERCENT' ? 99 : 525600;
      if (!Number.isInteger(value) || value < 1 || value > maximum) {
        throw new Error(`${key} must be an integer between 1 and ${maximum}`);
      }
      return [key, String(value)];
    }),
  );
}
