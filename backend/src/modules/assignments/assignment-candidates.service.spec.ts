import { jest } from '@jest/globals';
import {
  DriverCapability,
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { DriverLocationResponse, LocationsService } from '../locations/locations.service.js';
import { AssignmentCandidatesService } from './assignment-candidates.service.js';
import { AssignmentPolicy } from './assignment.policy.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import type { RouteMetric, RouteMetricsService } from '../routing/route-metrics.service.js';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const otherWarehouseId = '22222222-2222-4222-8222-222222222222';

function driver(
  id: string,
  employeeCode: string,
  operatingWarehouse: { id: string; city: string } | null,
) {
  return {
    id,
    userId: `${id.slice(0, -1)}a`,
    operatingWarehouseId: operatingWarehouse?.id ?? null,
    employeeCode,
    vehicleType: 'MOTORBIKE',
    vehiclePlate: `59-${employeeCode}`,
    status: DriverStatus.AVAILABLE,
    isOnline: true,
    isAvailable: true,
    capabilities: [DriverCapability.PICKUP, DriverCapability.DELIVERY] as DriverCapability[],
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: `${id.slice(0, -1)}a`,
      email: `${employeeCode.toLowerCase()}@example.test`,
      phone: null,
      passwordHash: 'hash',
      fullName: employeeCode,
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    operatingWarehouse: operatingWarehouse
      ? {
          ...operatingWarehouse,
          code: `WH-${employeeCode}`,
          name: `Warehouse ${employeeCode}`,
          address: 'Address',
          ward: null,
          district: null,
          latitude: new Prisma.Decimal(10.7769),
          longitude: new Prisma.Decimal(106.7009),
          isActive: true,
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
  };
}

function location(driverId: string, latitude: number, longitude: number): DriverLocationResponse {
  return { driverId, latitude, longitude, updatedAt: new Date().toISOString() };
}

function buildService(
  shipment: Record<string, unknown>,
  drivers: ReturnType<typeof driver>[],
  locations: Map<string, DriverLocationResponse>,
  calculateBatch: (
    requests: Array<{ origin: { latitude: number; longitude: number } }>,
  ) => Promise<RouteMetric[]> = (requests) =>
    Promise.resolve(
      requests.map((request) => ({
        distanceMeters: Math.round(request.origin.latitude * 1_000),
        durationSeconds: null,
        provider: 'HAVERSINE',
        calculatedAt: new Date('2026-09-05T01:00:00.000Z'),
        mode: 'HAVERSINE_FALLBACK',
      })),
    ),
) {
  const prisma = {
    shipment: { findUnique: jest.fn(() => Promise.resolve(shipment)) },
    driverProfile: { findMany: jest.fn(() => Promise.resolve(drivers)) },
  } as unknown as PrismaService;
  const locationService = {
    getCurrentDriverLocations: jest.fn(() => Promise.resolve(locations)),
  } as unknown as LocationsService;
  const calculateBatchMock = jest.fn(calculateBatch);
  const routeMetrics = {
    calculateBatch: calculateBatchMock,
  } as unknown as RouteMetricsService;
  return {
    service: new AssignmentCandidatesService(
      prisma,
      locationService,
      new AssignmentPolicy(),
      new ShipmentTransitionPolicy(),
      routeMetrics,
    ),
    calculateBatch: calculateBatchMock,
  };
}

describe('AssignmentCandidatesService', () => {
  it.each([
    {},
    { latitude: 10 },
    { longitude: 106 },
    { latitude: NaN, longitude: 106 },
    { latitude: 10, longitude: Infinity },
    { latitude: -91, longitude: 106 },
    { latitude: 91, longitude: 106 },
    { latitude: 10, longitude: -181 },
    { latitude: 10, longitude: 181 },
  ])('rejects invalid pickup snapshot coordinates safely: %j', async (coordinate) => {
    const { service, calculateBatch } = buildService(
      {
        id: 'shipment',
        status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
        pickupSnapshot: { city: 'Ho Chi Minh', ...coordinate },
      },
      [],
      new Map(),
    );
    await expect(service.listPickup('shipment')).rejects.toMatchObject({
      response: { code: 'ASSIGNMENT_TARGET_LOCATION_REQUIRED' },
    });
    expect(calculateBatch).not.toHaveBeenCalled();
  });

  it('ranks pickup candidates from current GPS to the pickup location and reports exclusions', async () => {
    const near = driver('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DRV-NEAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const far = driver('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DRV-FAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const wrongArea = driver('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'DRV-WRONG', {
      id: otherWarehouseId,
      city: 'Hà Nội',
    });
    const noGps = driver('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'DRV-NOGPS', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const lineHaulOnly = driver('ffffffff-ffff-4fff-8fff-ffffffffffff', 'DRV-LINEHAUL', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    lineHaulOnly.capabilities = [DriverCapability.LINE_HAUL];
    const locations = new Map([
      [near.id, location(near.id, 10.777, 106.701)],
      [far.id, location(far.id, 10.85, 106.75)],
      [wrongArea.id, location(wrongArea.id, 10.7769, 106.7009)],
    ]);
    const { service, calculateBatch } = buildService(
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
        pickupSnapshot: {
          streetAddress: '1 Main',
          city: 'Thanh pho Ho Chi Minh',
          latitude: 10.7769,
          longitude: 106.7009,
        },
        destinationWarehouseId: null,
        destinationWarehouse: null,
      },
      [far, wrongArea, noGps, lineHaulOnly, near],
      locations,
    );

    const result = await service.listPickup('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

    expect(result.assignmentType).toBe(DriverAssignmentType.PICKUP);
    expect(result.distanceMethod).toBe('HAVERSINE_FALLBACK');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([near.id, far.id]);
    expect(result.candidates[0].estimatedDistanceKm).toBeLessThan(
      result.candidates[1].estimatedDistanceKm,
    );
    expect(result.exclusions).toEqual({
      missingCapability: 1,
      noOperatingWarehouse: 0,
      outsideOperatingArea: 1,
      noCurrentLocation: 1,
    });
    expect(calculateBatch).toHaveBeenCalledTimes(1);
    expect(calculateBatch).toHaveBeenCalledWith([
      expect.objectContaining({ origin: { latitude: 10.777, longitude: 106.701 } }),
      expect.objectContaining({ origin: { latitude: 10.85, longitude: 106.75 } }),
    ]);
  });

  it('ranks delivery candidates against the destination warehouse and excludes another warehouse', async () => {
    const near = driver('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DRV-NEAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const far = driver('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DRV-FAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const wrongWarehouse = driver('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'DRV-WRONG', {
      id: otherWarehouseId,
      city: 'Hồ Chí Minh',
    });
    const locations = new Map([
      [near.id, location(near.id, 10.777, 106.701)],
      [far.id, location(far.id, 10.9, 106.8)],
      [wrongWarehouse.id, location(wrongWarehouse.id, 10.7769, 106.7009)],
    ]);
    const { service } = buildService(
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
        pickupSnapshot: {},
        destinationWarehouseId: warehouseId,
        destinationWarehouse: {
          id: warehouseId,
          code: 'WH-HCM',
          name: 'HCM Hub',
          city: 'Hồ Chí Minh',
          latitude: new Prisma.Decimal(10.7769),
          longitude: new Prisma.Decimal(106.7009),
        },
      },
      [far, wrongWarehouse, near],
      locations,
    );

    const result = await service.listDelivery('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

    expect(result.assignmentType).toBe(DriverAssignmentType.DELIVERY);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([near.id, far.id]);
    expect(result.exclusions.outsideOperatingArea).toBe(1);
  });

  it('ranks eligible drivers by road distance even when Haversine has the opposite order', async () => {
    const nearByAir = driver('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DRV-AIR-NEAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const farByAir = driver('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DRV-ROAD-NEAR', {
      id: warehouseId,
      city: 'Hồ Chí Minh',
    });
    const { service } = buildService(
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
        pickupSnapshot: {
          city: 'Hồ Chí Minh',
          latitude: 10.7769,
          longitude: 106.7009,
        },
        destinationWarehouseId: null,
        destinationWarehouse: null,
      },
      [nearByAir, farByAir],
      new Map([
        [nearByAir.id, location(nearByAir.id, 10.777, 106.701)],
        [farByAir.id, location(farByAir.id, 10.85, 106.75)],
      ]),
      () =>
        Promise.resolve([
          {
            distanceMeters: 9_000,
            durationSeconds: 900,
            provider: 'TEST_ROAD',
            calculatedAt: new Date(),
            mode: 'ROAD_ROUTE',
          },
          {
            distanceMeters: 4_000,
            durationSeconds: 500,
            provider: 'TEST_ROAD',
            calculatedAt: new Date(),
            mode: 'ROAD_ROUTE',
          },
        ]),
    );

    const result = await service.listPickup('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

    expect(result.distanceMethod).toBe('ROAD_ROUTE');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([farByAir.id, nearByAir.id]);
    expect(result.candidates[0]).toMatchObject({
      distanceMeters: 4_000,
      durationSeconds: 500,
      metricMode: 'ROAD_ROUTE',
    });
  });
});
