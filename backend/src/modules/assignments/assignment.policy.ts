import { ConflictException, Injectable } from '@nestjs/common';
import {
  DriverCapability,
  DriverAssignmentType,
  DriverAssignmentStatus,
  DriverStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { DriverLocationResponse } from '../locations/locations.service.js';
import { haversineDistanceMeters } from '../routing/route-metrics.service.js';

export const activeAssignmentStatuses: DriverAssignmentStatus[] = [
  DriverAssignmentStatus.PENDING,
  DriverAssignmentStatus.ACCEPTED,
];

export interface EligibleDriver {
  status: DriverStatus;
  isOnline: boolean;
  isAvailable: boolean;
  capabilities: DriverCapability[];
  user: { role: UserRole; status: UserStatus };
}

export interface LocationAwareDriver extends EligibleDriver {
  id: string;
  operatingWarehouseId: string | null;
  operatingWarehouse: {
    id: string;
    city: string;
    isActive: boolean;
  } | null;
}

export interface AssignmentTarget {
  type: DriverAssignmentType;
  warehouseId: string | null;
  city: string;
  latitude: number;
  longitude: number;
}

export type AssignmentEligibilityIssue =
  | 'DRIVER_CAPABILITY_REQUIRED'
  | 'DRIVER_OPERATING_WAREHOUSE_REQUIRED'
  | 'DRIVER_OUTSIDE_OPERATING_AREA'
  | 'DRIVER_CURRENT_LOCATION_REQUIRED';

export interface AssignmentEligibility {
  eligible: boolean;
  issue: AssignmentEligibilityIssue | null;
  estimatedDistanceKm: number | null;
}

@Injectable()
export class AssignmentPolicy {
  assertEligible(driver: EligibleDriver, assignmentType: DriverAssignmentType): void {
    if (
      driver.user.role !== UserRole.DRIVER ||
      driver.user.status !== UserStatus.ACTIVE ||
      driver.status === DriverStatus.SUSPENDED
    ) {
      throw new ConflictException({
        code: 'DRIVER_SUSPENDED',
        message: 'A suspended or inactive driver cannot be assigned',
      });
    }
    if (driver.status !== DriverStatus.AVAILABLE || !driver.isOnline || !driver.isAvailable) {
      throw new ConflictException({
        code: 'DRIVER_NOT_AVAILABLE',
        message: 'Driver must be online and available',
      });
    }
    const requiredCapability =
      assignmentType === DriverAssignmentType.PICKUP
        ? DriverCapability.PICKUP
        : DriverCapability.DELIVERY;
    if (!driver.capabilities.includes(requiredCapability)) {
      throw new ConflictException({
        code: 'DRIVER_CAPABILITY_REQUIRED',
        message: `Driver needs the ${requiredCapability} capability for this assignment`,
      });
    }
  }

  evaluate(
    driver: LocationAwareDriver,
    target: AssignmentTarget,
    location: DriverLocationResponse | null,
  ): AssignmentEligibility {
    const requiredCapability =
      target.type === DriverAssignmentType.PICKUP
        ? DriverCapability.PICKUP
        : DriverCapability.DELIVERY;
    if (!driver.capabilities.includes(requiredCapability)) {
      return this.ineligible('DRIVER_CAPABILITY_REQUIRED');
    }
    if (!driver.operatingWarehouse || !driver.operatingWarehouse.isActive) {
      return this.ineligible('DRIVER_OPERATING_WAREHOUSE_REQUIRED');
    }
    const areaMatches =
      target.type === DriverAssignmentType.DELIVERY
        ? driver.operatingWarehouseId === target.warehouseId
        : this.normalizeCity(driver.operatingWarehouse.city) === this.normalizeCity(target.city);
    if (!areaMatches) return this.ineligible('DRIVER_OUTSIDE_OPERATING_AREA');
    if (!location) return this.ineligible('DRIVER_CURRENT_LOCATION_REQUIRED');
    return {
      eligible: true,
      issue: null,
      estimatedDistanceKm:
        Math.round(
          (haversineDistanceMeters(
            { latitude: location.latitude, longitude: location.longitude },
            { latitude: target.latitude, longitude: target.longitude },
          ) /
            1_000) *
            100,
        ) / 100,
    };
  }

  assertLocationAwareEligible(
    driver: LocationAwareDriver,
    target: AssignmentTarget,
    location: DriverLocationResponse | null,
  ): number {
    this.assertEligible(driver, target.type);
    const result = this.evaluate(driver, target, location);
    if (result.eligible && result.estimatedDistanceKm !== null) {
      return result.estimatedDistanceKm;
    }
    const messages: Record<AssignmentEligibilityIssue, string> = {
      DRIVER_CAPABILITY_REQUIRED: 'Driver does not have the required assignment capability',
      DRIVER_OPERATING_WAREHOUSE_REQUIRED:
        'Driver needs an active operating warehouse before assignment',
      DRIVER_OUTSIDE_OPERATING_AREA: 'Driver is outside the shipment operating area',
      DRIVER_CURRENT_LOCATION_REQUIRED: 'Driver needs a current GPS location before assignment',
    };
    throw new ConflictException({
      code: result.issue,
      message: messages[result.issue as AssignmentEligibilityIssue],
    });
  }

  private ineligible(issue: AssignmentEligibilityIssue): AssignmentEligibility {
    return { eligible: false, issue, estimatedDistanceKm: null };
  }

  private normalizeCity(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replaceAll('đ', 'd')
      .toLowerCase()
      .replace(/^(thanh pho|tp|tinh)\s+/, '')
      .replace(/\s+city$/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
