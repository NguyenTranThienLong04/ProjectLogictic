import { ConflictException } from '@nestjs/common';
import {
  DriverAssignmentType,
  DriverCapability,
  DriverStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { AssignmentPolicy } from './assignment.policy.js';

describe('AssignmentPolicy', () => {
  const policy = new AssignmentPolicy();
  const locationAwareDriver = {
    id: '11111111-1111-4111-8111-111111111111',
    status: DriverStatus.AVAILABLE,
    isOnline: true,
    isAvailable: true,
    capabilities: [DriverCapability.PICKUP, DriverCapability.DELIVERY],
    user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
    operatingWarehouseId: '22222222-2222-4222-8222-222222222222',
    operatingWarehouse: {
      id: '22222222-2222-4222-8222-222222222222',
      city: 'Hồ Chí Minh',
      isActive: true,
    },
  };

  it('allows only active, online and available drivers', () => {
    expect(() =>
      policy.assertEligible(
        {
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
          capabilities: [DriverCapability.PICKUP],
          user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        },
        DriverAssignmentType.PICKUP,
      ),
    ).not.toThrow();
  });

  it('rejects a suspended driver even if stale flags claim availability', () => {
    expect(() =>
      policy.assertEligible(
        {
          status: DriverStatus.SUSPENDED,
          isOnline: true,
          isAvailable: true,
          capabilities: [DriverCapability.PICKUP],
          user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        },
        DriverAssignmentType.PICKUP,
      ),
    ).toThrow(ConflictException);
  });

  it('rejects a driver without the assignment capability', () => {
    expect(() =>
      policy.assertEligible(
        {
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
          capabilities: [DriverCapability.LINE_HAUL],
          user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
        },
        DriverAssignmentType.PICKUP,
      ),
    ).toThrow(ConflictException);
  });

  it('rejects a pickup driver outside the normalized warehouse city service area', () => {
    try {
      policy.assertLocationAwareEligible(
        locationAwareDriver,
        {
          type: DriverAssignmentType.PICKUP,
          warehouseId: null,
          city: 'Hà Nội',
          latitude: 21.0285,
          longitude: 105.8542,
        },
        {
          driverId: locationAwareDriver.id,
          latitude: 10.78,
          longitude: 106.69,
          updatedAt: new Date().toISOString(),
        },
      );
      throw new Error('Expected assignment policy to reject the driver');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'DRIVER_OUTSIDE_OPERATING_AREA',
      });
    }
  });

  it('requires current GPS and calculates Haversine distance without producing ETA', () => {
    const target = {
      type: DriverAssignmentType.PICKUP,
      warehouseId: null,
      city: 'Thanh pho Ho Chi Minh',
      latitude: 10.7769,
      longitude: 106.7009,
    };
    try {
      policy.assertLocationAwareEligible(locationAwareDriver, target, null);
      throw new Error('Expected assignment policy to require GPS');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'DRIVER_CURRENT_LOCATION_REQUIRED',
      });
    }
    expect(
      policy.assertLocationAwareEligible(locationAwareDriver, target, {
        driverId: locationAwareDriver.id,
        latitude: 10.7869,
        longitude: 106.7009,
        updatedAt: new Date().toISOString(),
      }),
    ).toBeCloseTo(1.11, 1);
  });

  it('requires delivery drivers to operate from the exact destination warehouse', () => {
    const result = policy.evaluate(
      locationAwareDriver,
      {
        type: DriverAssignmentType.DELIVERY,
        warehouseId: '33333333-3333-4333-8333-333333333333',
        city: 'Hồ Chí Minh',
        latitude: 10.7769,
        longitude: 106.7009,
      },
      {
        driverId: locationAwareDriver.id,
        latitude: 10.78,
        longitude: 106.69,
        updatedAt: new Date().toISOString(),
      },
    );
    expect(result).toMatchObject({
      eligible: false,
      issue: 'DRIVER_OUTSIDE_OPERATING_AREA',
    });
  });
});
