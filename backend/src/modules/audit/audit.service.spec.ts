import { jest } from '@jest/globals';
import { UserRole } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
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
