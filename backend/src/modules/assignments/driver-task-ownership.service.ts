import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { executingLineHaulTripStatuses } from '../line-haul/line-haul.constants.js';
import { activeAssignmentStatuses } from './assignment.policy.js';

@Injectable()
export class DriverTaskOwnershipService {
  async lock(transaction: Prisma.TransactionClient, driverId: string): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "DriverProfile" WHERE "id" = ${driverId}::uuid FOR UPDATE
    `;
  }

  async assertNoActiveLineHaulTrip(
    transaction: Prisma.TransactionClient,
    driverId: string,
  ): Promise<void> {
    const trip = await transaction.lineHaulTrip.findFirst({
      where: { driverId, status: { in: executingLineHaulTripStatuses } },
      select: { id: true },
    });
    if (trip) {
      throw new ConflictException({
        code: 'DRIVER_ACTIVE_LINE_HAUL_TRIP',
        message: 'Driver cannot receive pickup or delivery work while a trip is ready or running',
      });
    }
  }

  async assertNoActiveAssignment(
    transaction: Prisma.TransactionClient,
    driverId: string,
  ): Promise<void> {
    const assignment = await transaction.driverAssignment.findFirst({
      where: { driverId, status: { in: activeAssignmentStatuses } },
      select: { id: true },
    });
    if (assignment) {
      throw new ConflictException({
        code: 'DRIVER_ACTIVE_PICKUP_DELIVERY_ASSIGNMENT',
        message: 'Driver must finish pickup or delivery work before owning a line-haul trip',
      });
    }
  }
}
