import { ConflictException, Injectable } from '@nestjs/common';
import { ShipmentStatus } from '../../generated/prisma/client.js';

@Injectable()
export class ShipmentTransitionPolicy {
  assertConfirmable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.PENDING, ShipmentStatus.CONFIRMED], 'confirm');
  }

  assertAssignable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT], 'assign pickup driver');
  }

  assertReassignable(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.PICKUP_ASSIGNED, ShipmentStatus.PICKUP_IN_PROGRESS],
      'reassign pickup driver',
    );
  }

  assertAcceptable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.PICKUP_ASSIGNED], 'accept pickup assignment');
  }

  assertRejectable(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.PICKUP_ASSIGNED, ShipmentStatus.PICKUP_IN_PROGRESS],
      'reject pickup assignment',
    );
  }

  assertPickupable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.PICKUP_IN_PROGRESS], 'complete pickup');
  }

  assertOriginCheckIn(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.PICKED_UP], 'origin check-in');
  }

  assertDestinationRoutable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.AT_ORIGIN_WAREHOUSE], 'route destination warehouse');
  }

  assertTransferCreatable(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.AT_ORIGIN_WAREHOUSE, ShipmentStatus.AT_DESTINATION_WAREHOUSE],
      'create warehouse transfer',
    );
  }

  assertTransferDispatch(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.AT_ORIGIN_WAREHOUSE, ShipmentStatus.AT_DESTINATION_WAREHOUSE],
      'dispatch warehouse transfer',
    );
  }

  assertTransferReceive(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.IN_TRANSIT], 'receive warehouse transfer');
  }

  assertReadyForDelivery(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.AT_DESTINATION_WAREHOUSE, ShipmentStatus.AT_ORIGIN_WAREHOUSE],
      'mark ready for delivery',
    );
  }

  assertDeliveryAssignable(status: ShipmentStatus): void {
    this.assertOneOf(
      status,
      [ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT],
      'assign delivery driver',
    );
  }

  assertDeliveryStartable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.DELIVERY_ASSIGNED], 'start delivery');
  }

  assertDeliverable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.OUT_FOR_DELIVERY], 'complete delivery');
  }

  assertDeliveryFailing(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.OUT_FOR_DELIVERY], 'fail delivery');
  }

  assertRedeliverable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.DELIVERY_FAILED], 'schedule redelivery');
  }

  assertReturnRequestable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.DELIVERY_FAILED], 'request return');
  }

  assertReturnStartable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.RETURN_REQUESTED], 'start return');
  }

  assertReturnReceivable(status: ShipmentStatus): void {
    this.assertOneOf(status, [ShipmentStatus.RETURN_IN_TRANSIT], 'receive return');
  }

  private assertOneOf(status: ShipmentStatus, allowed: ShipmentStatus[], command: string): void {
    if (!allowed.includes(status)) {
      throw new ConflictException({
        code: 'SHIPMENT_TRANSITION_INVALID',
        message: `Cannot ${command} while shipment is ${status}`,
      });
    }
  }
}
