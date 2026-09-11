import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { DriverTaskOwnershipService } from './driver-task-ownership.service.js';

describe('DriverTaskOwnershipService', () => {
  const service = new DriverTaskOwnershipService();

  it('rejects pickup or delivery assignment while a driver owns an active line-haul trip', async () => {
    const transaction = {
      lineHaulTrip: { findFirst: () => Promise.resolve({ id: 'trip-1' }) },
    } as unknown as Prisma.TransactionClient;

    await expect(service.assertNoActiveLineHaulTrip(transaction, 'driver-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects line-haul ownership while a driver has an active shipment assignment', async () => {
    const transaction = {
      driverAssignment: { findFirst: () => Promise.resolve({ id: 'assignment-1' }) },
    } as unknown as Prisma.TransactionClient;

    await expect(service.assertNoActiveAssignment(transaction, 'driver-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows ownership checks when neither workflow is active', async () => {
    const transaction = {
      lineHaulTrip: { findFirst: () => Promise.resolve(null) },
      driverAssignment: { findFirst: () => Promise.resolve(null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service.assertNoActiveLineHaulTrip(transaction, 'driver-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertNoActiveAssignment(transaction, 'driver-1'),
    ).resolves.toBeUndefined();
  });
});
