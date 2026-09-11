import { jest } from '@jest/globals';
import { ShipmentStatus } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { DashboardsService } from './dashboards.service.js';

describe('DashboardsService', () => {
  it('calculates customer metrics in PostgreSQL and only returns owned recent shipments', async () => {
    const customerId = '11111111-1111-4111-8111-111111111111';
    const queryRaw = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce([
        {
          totalShipments: 7,
          pending: 1,
          inTransit: 1,
          outForDelivery: 1,
          delivered: 3,
          failed: 1,
          cancelled: 0,
          deliverySuccessRate: 75,
          averageDeliveryTimeHours: 12.5,
        },
      ])
      .mockResolvedValueOnce([{ codCollected: 500000, codUnsettled: 150000 }]);
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: '22222222-2222-4222-8222-222222222222',
          trackingCode: 'SHP-20260826-ABC12345',
          status: ShipmentStatus.IN_TRANSIT,
          receiverSnapshot: { fullName: 'Receiver' },
          deliverySnapshot: { city: 'Hồ Chí Minh' },
          createdAt: new Date('2026-08-26T00:00:00.000Z'),
        },
      ]),
    );
    const prisma = {
      $queryRaw: queryRaw,
      shipment: { findMany },
    } as unknown as PrismaService;

    const dashboard = await new DashboardsService(prisma).customer(customerId);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId }, take: 5 }),
    );
    expect(dashboard.overview).toMatchObject({
      totalShipments: 7,
      deliverySuccessRate: 75,
      codCollected: 500000,
      codUnsettled: 150000,
    });
    expect(dashboard.recentShipments[0]).toMatchObject({
      receiverName: 'Receiver',
      deliveryCity: 'Hồ Chí Minh',
    });
  });
});
