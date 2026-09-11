import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DriverCapability,
  DriverStatus,
  LineHaulVehicleStatus,
  LineHaulTripStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { LineHaulPolicy } from './line-haul.policy.js';

describe('LineHaulPolicy', () => {
  const policy = new LineHaulPolicy();
  const eligibleDriver = {
    status: DriverStatus.OFFLINE,
    capabilities: [DriverCapability.PICKUP, DriverCapability.LINE_HAUL],
    user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
  };

  it('rejects a trip whose origin equals its destination', () => {
    expect(() => policy.assertDistinctWarehouses('warehouse-a', 'warehouse-a')).toThrow(
      BadRequestException,
    );
  });

  it('allows an active non-suspended driver with line-haul capability', () => {
    expect(() => policy.assertDriverEligible(eligibleDriver)).not.toThrow();
  });

  it('rejects a driver without line-haul capability', () => {
    expect(() =>
      policy.assertDriverEligible({
        ...eligibleDriver,
        capabilities: [DriverCapability.PICKUP, DriverCapability.DELIVERY],
      }),
    ).toThrow(ConflictException);
  });

  it.each([
    { userStatus: UserStatus.SUSPENDED, profileStatus: DriverStatus.OFFLINE },
    { userStatus: UserStatus.ACTIVE, profileStatus: DriverStatus.SUSPENDED },
  ])('rejects inactive or suspended line-haul drivers', ({ profileStatus, userStatus }) => {
    expect(() =>
      policy.assertDriverEligible({
        ...eligibleDriver,
        status: profileStatus,
        user: { ...eligibleDriver.user, status: userStatus },
      }),
    ).toThrow(ConflictException);
  });

  it.each([LineHaulVehicleStatus.MAINTENANCE, LineHaulVehicleStatus.INACTIVE])(
    'rejects an unavailable vehicle in %s status',
    (status) => {
      expect(() =>
        policy.assertVehicleEligible({ status, capacityWeightGrams: 5_000_000 }),
      ).toThrow(ConflictException);
    },
  );

  it('rejects an available vehicle without a positive capacity', () => {
    expect(() =>
      policy.assertVehicleEligible({
        status: LineHaulVehicleStatus.AVAILABLE,
        capacityWeightGrams: null,
      }),
    ).toThrow(ConflictException);
  });

  it('rejects a warehouse transfer whose route differs from the trip', () => {
    expect(() =>
      policy.assertTransferMatchesTrip(
        {
          fromWarehouseId: 'warehouse-a',
          toWarehouseId: 'warehouse-c',
          status: WarehouseTransferStatus.PENDING,
        },
        { originWarehouseId: 'warehouse-a', destinationWarehouseId: 'warehouse-b' },
      ),
    ).toThrow(ConflictException);
  });

  it('locks the manifest after a trip leaves PLANNED', () => {
    expect(() => policy.assertTripConfigurable(LineHaulTripStatus.PLANNED)).not.toThrow();
    expect(() => policy.assertTripConfigurable(LineHaulTripStatus.READY)).toThrow(
      ConflictException,
    );
  });

  it('accepts a positive schedule window and allows adjacent boundaries', () => {
    expect(() =>
      policy.assertScheduleWindow(
        new Date('2026-09-07T03:00:00.000Z'),
        new Date('2026-09-07T05:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      policy.assertScheduleWindow(
        new Date('2026-09-07T05:00:00.000Z'),
        new Date('2026-09-07T07:00:00.000Z'),
      ),
    ).not.toThrow();
  });

  it('rejects zero-length, reversed, and missing execution schedules', () => {
    expect(() =>
      policy.assertScheduleWindow(
        new Date('2026-09-07T05:00:00.000Z'),
        new Date('2026-09-07T05:00:00.000Z'),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      policy.assertScheduleWindow(
        new Date('2026-09-07T06:00:00.000Z'),
        new Date('2026-09-07T05:00:00.000Z'),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      policy.assertSchedulePresent({ scheduledStartAt: null, scheduledEndAt: null }),
    ).toThrow(ConflictException);
  });

  it('allows scheduling commands only while a trip is planned', () => {
    expect(() => policy.assertTripSchedulable(LineHaulTripStatus.PLANNED)).not.toThrow();
    expect(() => policy.assertTripSchedulable(LineHaulTripStatus.READY)).toThrow(ConflictException);
  });

  it('enforces the explicit ready, dispatch and arrival transitions', () => {
    expect(() => policy.assertTripPrepareable(LineHaulTripStatus.PLANNED)).not.toThrow();
    expect(() => policy.assertTripPrepareable(LineHaulTripStatus.READY)).toThrow(ConflictException);
    expect(() => policy.assertTripDispatchable(LineHaulTripStatus.READY)).not.toThrow();
    expect(() => policy.assertTripDispatchable(LineHaulTripStatus.PLANNED)).toThrow(
      ConflictException,
    );
    expect(() => policy.assertTripArrivable(LineHaulTripStatus.IN_TRANSIT)).not.toThrow();
    expect(() => policy.assertTripArrivable(LineHaulTripStatus.READY)).toThrow(ConflictException);
  });

  it('rejects cancellation after departure', () => {
    expect(() => policy.assertTripCancellable(LineHaulTripStatus.READY)).not.toThrow();
    expect(() => policy.assertTripCancellable(LineHaulTripStatus.IN_TRANSIT)).toThrow(
      ConflictException,
    );
  });
});
