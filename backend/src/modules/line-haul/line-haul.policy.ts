import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulVehicleStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import {
  cancellableLineHaulTripStatuses,
  configurableLineHaulTripStatuses,
} from './line-haul.constants.js';
import { assertValidVehicleCapacity } from './line-haul-capacity.js';

interface LineHaulDriverCandidate {
  status: DriverStatus;
  capabilities: DriverCapability[];
  user: { role: UserRole; status: UserStatus };
}

interface LineHaulVehicleCandidate {
  status: LineHaulVehicleStatus;
  capacityWeightGrams: number | null;
}

interface TransferRoute {
  fromWarehouseId: string;
  toWarehouseId: string;
  status: WarehouseTransferStatus;
}

@Injectable()
export class LineHaulPolicy {
  assertDistinctWarehouses(originWarehouseId: string, destinationWarehouseId: string): void {
    if (originWarehouseId === destinationWarehouseId) {
      throw new BadRequestException({
        code: 'LINE_HAUL_SAME_WAREHOUSE',
        message: 'Origin and destination warehouses must be different',
      });
    }
  }

  assertDriverEligible(driver: LineHaulDriverCandidate): void {
    if (
      driver.user.role !== UserRole.DRIVER ||
      driver.user.status !== UserStatus.ACTIVE ||
      driver.status === DriverStatus.SUSPENDED
    ) {
      throw new ConflictException({
        code: 'LINE_HAUL_DRIVER_INACTIVE',
        message: 'Line-haul driver account and profile must be active and not suspended',
      });
    }
    if (!driver.capabilities.includes(DriverCapability.LINE_HAUL)) {
      throw new ConflictException({
        code: 'LINE_HAUL_CAPABILITY_REQUIRED',
        message: 'Driver does not have the LINE_HAUL capability',
      });
    }
  }

  assertVehicleEligible(vehicle: LineHaulVehicleCandidate): void {
    if (vehicle.status !== LineHaulVehicleStatus.AVAILABLE) {
      throw new ConflictException({
        code: 'LINE_HAUL_VEHICLE_NOT_AVAILABLE',
        message: 'Line-haul vehicle must be available',
      });
    }
    assertValidVehicleCapacity(vehicle.capacityWeightGrams);
  }

  assertTripConfigurable(status: LineHaulTripStatus): void {
    if (!configurableLineHaulTripStatuses.includes(status)) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_CONFIGURABLE',
        message: 'Transfers can only be changed while a trip is planned',
      });
    }
  }

  assertTripSchedulable(status: LineHaulTripStatus): void {
    if (status !== LineHaulTripStatus.PLANNED) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_SCHEDULABLE',
        message: 'Only a planned trip can be scheduled, rescheduled, or unscheduled',
      });
    }
  }

  assertScheduleWindow(start: Date, end: Date): void {
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new BadRequestException({
        code: 'LINE_HAUL_SCHEDULE_INVALID',
        message: 'Schedule start and end must be valid date-time values',
      });
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException({
        code: 'LINE_HAUL_SCHEDULE_RANGE_INVALID',
        message: 'Schedule end must be later than schedule start',
      });
    }
  }

  assertSchedulePresent(trip: {
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
  }): void {
    if (!trip.scheduledStartAt || !trip.scheduledEndAt) {
      throw new ConflictException({
        code: 'LINE_HAUL_SCHEDULE_REQUIRED',
        message: 'Schedule the trip before marking it ready or dispatching it',
      });
    }
    this.assertScheduleWindow(trip.scheduledStartAt, trip.scheduledEndAt);
  }

  assertTripPrepareable(status: LineHaulTripStatus): void {
    if (status !== LineHaulTripStatus.PLANNED) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_PREPAREABLE',
        message: 'Only a planned trip can be marked ready',
      });
    }
  }

  assertTripDispatchable(status: LineHaulTripStatus): void {
    if (status !== LineHaulTripStatus.READY) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_DISPATCHABLE',
        message: 'Only a ready trip can be dispatched',
      });
    }
  }

  assertTripArrivable(status: LineHaulTripStatus): void {
    if (status !== LineHaulTripStatus.IN_TRANSIT) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_ARRIVABLE',
        message: 'Only an in-transit trip can confirm arrival',
      });
    }
  }

  assertTripCancellable(status: LineHaulTripStatus): void {
    if (!cancellableLineHaulTripStatuses.includes(status)) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_NOT_CANCELLABLE',
        message: 'Only a planned or ready trip can be cancelled',
      });
    }
  }

  assertTransferMatchesTrip(
    transfer: TransferRoute,
    trip: { originWarehouseId: string; destinationWarehouseId: string },
  ): void {
    if (transfer.status !== WarehouseTransferStatus.PENDING) {
      throw new ConflictException({
        code: 'WAREHOUSE_TRANSFER_NOT_PENDING',
        message: 'Only a pending warehouse transfer can be assigned to a planned trip',
      });
    }
    if (
      transfer.fromWarehouseId !== trip.originWarehouseId ||
      transfer.toWarehouseId !== trip.destinationWarehouseId
    ) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRANSFER_ROUTE_MISMATCH',
        message: 'Warehouse transfer route must match the line-haul trip route',
      });
    }
  }
}
