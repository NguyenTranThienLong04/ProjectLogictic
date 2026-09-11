import { ConflictException } from '@nestjs/common';
import { ShipmentStatus } from '../../generated/prisma/client.js';
import { CancellationPolicy } from './cancellation.policy.js';

describe('CancellationPolicy', () => {
  const policy = new CancellationPolicy();

  it.each([
    ShipmentStatus.PENDING,
    ShipmentStatus.CONFIRMED,
    ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
  ])('allows customer cancellation from %s', (status) => {
    expect(() => policy.assertCustomerCanCancel(status)).not.toThrow();
  });

  it('rejects cancellation from a terminal status', () => {
    expect(() => policy.assertCustomerCanCancel(ShipmentStatus.CANCELLED)).toThrow(
      ConflictException,
    );
  });
});
