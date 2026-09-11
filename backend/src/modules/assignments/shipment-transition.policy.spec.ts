import { ConflictException } from '@nestjs/common';
import { ShipmentStatus } from '../../generated/prisma/client.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';

describe('ShipmentTransitionPolicy', () => {
  const policy = new ShipmentTransitionPolicy();

  it('allows the confirm command from PENDING', () => {
    expect(() => policy.assertConfirmable(ShipmentStatus.PENDING)).not.toThrow();
  });

  it('rejects an arbitrary lifecycle jump through the pickup command', () => {
    expect(() => policy.assertPickupable(ShipmentStatus.PENDING)).toThrow(ConflictException);
  });

  it('allows origin check-in only from PICKED_UP', () => {
    expect(() => policy.assertOriginCheckIn(ShipmentStatus.PICKED_UP)).not.toThrow();
    expect(() => policy.assertOriginCheckIn(ShipmentStatus.PENDING)).toThrow(ConflictException);
  });

  it('allows transfer dispatch from warehouse statuses', () => {
    expect(() => policy.assertTransferDispatch(ShipmentStatus.AT_ORIGIN_WAREHOUSE)).not.toThrow();
    expect(() => policy.assertTransferDispatch(ShipmentStatus.PICKED_UP)).toThrow(
      ConflictException,
    );
  });

  it('allows transfer receive only from IN_TRANSIT', () => {
    expect(() => policy.assertTransferReceive(ShipmentStatus.IN_TRANSIT)).not.toThrow();
    expect(() => policy.assertTransferReceive(ShipmentStatus.PICKED_UP)).toThrow(ConflictException);
  });

  it('allows ready for delivery from destination or origin warehouse', () => {
    expect(() =>
      policy.assertReadyForDelivery(ShipmentStatus.AT_DESTINATION_WAREHOUSE),
    ).not.toThrow();
    expect(() => policy.assertReadyForDelivery(ShipmentStatus.IN_TRANSIT)).toThrow(
      ConflictException,
    );
  });
});
