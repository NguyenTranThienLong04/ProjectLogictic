import { ConflictException, Injectable } from '@nestjs/common';
import { ShipmentStatus } from '../../generated/prisma/client.js';

@Injectable()
export class CancellationPolicy {
  private readonly customerCancellableStatuses = new Set<ShipmentStatus>([
    ShipmentStatus.PENDING,
    ShipmentStatus.CONFIRMED,
    ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT,
  ]);

  assertCustomerCanCancel(status: ShipmentStatus): void {
    if (!this.customerCancellableStatuses.has(status)) {
      throw new ConflictException({
        code: 'SHIPMENT_CANNOT_CANCEL',
        message: `Shipment cannot be cancelled from ${status}`,
      });
    }
  }

  canCustomerCancel(status: ShipmentStatus): boolean {
    return this.customerCancellableStatuses.has(status);
  }
}
