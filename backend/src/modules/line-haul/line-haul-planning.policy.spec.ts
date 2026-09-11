import {
  buildDepartureWindows,
  resolvePlanningDurationMinutes,
  scoreLineHaulPlanning,
  selectTransfersForCapacity,
  type PlanningDriver,
  type PlanningTransfer,
  type PlanningVehicle,
} from './line-haul-planning.policy.js';

const drivers: PlanningDriver[] = [
  {
    id: 'driver-b',
    employeeCode: 'DRV-002',
    fullName: 'Driver Two',
    operatingWarehouseId: null,
  },
  {
    id: 'driver-a',
    employeeCode: 'DRV-001',
    fullName: 'Driver One',
    operatingWarehouseId: 'origin',
  },
];

const vehicles: PlanningVehicle[] = [
  {
    id: 'vehicle-a',
    vehicleCode: 'TRUCK-01',
    licensePlate: '51A-001',
    vehicleType: 'Truck',
    capacityWeightGrams: 2_000,
  },
  {
    id: 'vehicle-b',
    vehicleCode: 'TRUCK-02',
    licensePlate: '51A-002',
    vehicleType: 'Truck',
    capacityWeightGrams: 1_500,
  },
];

const transfers: PlanningTransfer[] = [
  {
    id: 'transfer-a',
    transferCode: 'TRF-001',
    trackingCode: 'SHP-001',
    loadWeightGrams: 1_000,
    createdAt: new Date('2035-01-01T00:00:00.000Z'),
  },
  {
    id: 'transfer-b',
    transferCode: 'TRF-002',
    trackingCode: 'SHP-002',
    loadWeightGrams: 900,
    createdAt: new Date('2035-01-01T00:01:00.000Z'),
  },
  {
    id: 'transfer-c',
    transferCode: 'TRF-003',
    trackingCode: 'SHP-003',
    loadWeightGrams: 600,
    createdAt: new Date('2035-01-01T00:02:00.000Z'),
  },
];

describe('LineHaulPlanningPolicy', () => {
  it('produces the same explicit score and stable tie-break order for identical input', () => {
    const input = {
      originWarehouseId: 'origin',
      destinationWarehouseId: 'destination',
      earliestStartAt: new Date('2035-01-02T01:00:00.000Z'),
      latestEndAt: new Date('2035-01-02T08:00:00.000Z'),
      drivers,
      vehicles,
      transfers,
      conflicts: [],
      route: {
        distanceMeters: 120_000,
        durationSeconds: null,
        mode: 'HAVERSINE_FALLBACK' as const,
        calculatedAt: new Date('2035-01-01T00:00:00.000Z'),
      },
      maxRecommendations: 6,
    };

    const first = scoreLineHaulPlanning(input);
    const second = scoreLineHaulPlanning({
      ...input,
      drivers: [...drivers].reverse(),
      vehicles: [...vehicles].reverse(),
      transfers: [...transfers].reverse(),
    });

    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({
      rank: 1,
      score: 81,
      driver: { employeeCode: 'DRV-001' },
      vehicle: { vehicleCode: 'TRUCK-01' },
      manifestWeightGrams: 1_900,
      capacityUtilizationPercent: 95,
    });
    expect(first[0].reasons.map(({ points }) => points)).toEqual([43, 8, 20, 5, 5]);
  });

  it('excludes conflicting resources but allows exact half-open adjacency', () => {
    const recommendations = scoreLineHaulPlanning({
      originWarehouseId: 'origin',
      destinationWarehouseId: 'destination',
      earliestStartAt: new Date('2035-01-02T01:00:00.000Z'),
      latestEndAt: new Date('2035-01-02T05:00:00.000Z'),
      drivers,
      vehicles,
      transfers,
      conflicts: [
        {
          driverId: 'driver-a',
          vehicleId: 'other-vehicle',
          scheduledStartAt: new Date('2035-01-02T00:00:00.000Z'),
          scheduledEndAt: new Date('2035-01-02T01:00:00.000Z'),
        },
        {
          driverId: 'other-driver',
          vehicleId: 'vehicle-b',
          scheduledStartAt: null,
          scheduledEndAt: null,
        },
        {
          driverId: 'driver-b',
          vehicleId: 'other-vehicle',
          scheduledStartAt: new Date('2035-01-02T01:30:00.000Z'),
          scheduledEndAt: new Date('2035-01-02T04:00:00.000Z'),
        },
      ],
      route: null,
      maxRecommendations: 10,
    });

    expect(recommendations).toHaveLength(3);
    expect(
      recommendations.every(
        (recommendation) =>
          recommendation.driver.id === 'driver-a' && recommendation.vehicle.id === 'vehicle-a',
      ),
    ).toBe(true);
    expect(recommendations[0]).toMatchObject({
      driver: { id: 'driver-a' },
      vehicle: { id: 'vehicle-a' },
      scheduledStartAt: new Date('2035-01-02T01:00:00.000Z'),
    });
  });

  it('never overloads a vehicle and skips a non-fitting transfer without stopping grouping', () => {
    const selected = selectTransfersForCapacity(
      [
        transfers[0],
        { ...transfers[1], loadWeightGrams: 1_100 },
        { ...transfers[2], loadWeightGrams: 500 },
      ],
      1_500,
    );
    expect(selected.map(({ id }) => id)).toEqual(['transfer-a', 'transfer-c']);
    expect(selected.reduce((sum, transfer) => sum + transfer.loadWeightGrams, 0)).toBe(1_500);
  });

  it('uses road duration with buffer and deterministic slots, or a documented fallback', () => {
    expect(resolvePlanningDurationMinutes(5_400)).toBe(120);
    expect(resolvePlanningDurationMinutes(null)).toBe(180);
    expect(
      buildDepartureWindows(
        new Date('2035-01-02T01:00:00.000Z'),
        new Date('2035-01-02T03:00:00.000Z'),
        60,
      ).map((window) => [window.start.toISOString(), window.end.toISOString()]),
    ).toEqual([
      ['2035-01-02T01:00:00.000Z', '2035-01-02T02:00:00.000Z'],
      ['2035-01-02T01:30:00.000Z', '2035-01-02T02:30:00.000Z'],
      ['2035-01-02T02:00:00.000Z', '2035-01-02T03:00:00.000Z'],
    ]);
  });
});
