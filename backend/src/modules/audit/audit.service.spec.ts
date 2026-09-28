import { jest } from '@jest/globals';
import { UserRole } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('finds legacy delivery logs through proven shipment relations without rewriting their entity IDs', async () => {
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    const findMany = jest.fn(() => Promise.resolve([]));
    const count = jest.fn(() => Promise.resolve(0));
    const findAttempts = jest.fn(() => Promise.resolve([{ id: 'attempt-id' }]));
    const prisma = {
      auditLog: { findMany, count },
      deliveryAttempt: { findMany: findAttempts },
      driverAssignment: { findMany: jest.fn(() => Promise.resolve([{ id: 'assignment-id' }])) },
    } as unknown as PrismaService;
    await new AuditService(prisma).list({
      search: shipmentId,
      entityType: 'Shipment',
      page: 1,
      limit: 20,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              entityType: 'Shipment',
              action: { in: ['DELIVERY_COMPLETE', 'DELIVERY_FAIL', 'RETURN_START'] },
              entityId: { in: ['attempt-id'] },
            },
            {
              entityType: 'Shipment',
              action: { in: ['DELIVERY_DRIVER_ASSIGN', 'DELIVERY_START'] },
              entityId: { in: ['assignment-id'] },
            },
          ]) as unknown,
        }) as unknown,
      }),
    );
    expect(findAttempts).toHaveBeenCalledWith({
      where: { shipmentId },
      select: { id: true },
    });
  });
  it('uses bounded pagination and server-side admin audit filters', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const count = jest.fn(() => Promise.resolve(0));
    const prisma = { auditLog: { findMany, count } } as unknown as PrismaService;

    const result = await new AuditService(prisma).list({
      actorRole: UserRole.DISPATCHER,
      search: 'shipment',
      fromDate: '2026-08-01',
      toDate: '2026-08-26',
      page: 2,
      limit: 20,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20, orderBy: { createdAt: 'desc' } }),
    );
    expect(count).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [], page: 2, limit: 20, total: 0, totalPages: 0 });
  });
});
