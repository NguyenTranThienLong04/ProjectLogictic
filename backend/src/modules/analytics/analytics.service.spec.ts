import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../database/prisma.service.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsGranularity } from './dto/analytics-query.dto.js';

function renderSqlValue(value: unknown): string {
  if (value && typeof value === 'object' && 'strings' in value && 'values' in value) {
    const sql = value as { strings: readonly string[]; values: readonly unknown[] };
    return sql.strings.reduce(
      (text, part, index) => `${text}${part}${renderSqlValue(sql.values[index])}`,
      '',
    );
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function renderSqlCall(call: unknown[]): string {
  const [strings, ...values] = call as [readonly string[], ...unknown[]];
  return strings.reduce(
    (text, part, index) => `${text}${part}${renderSqlValue(values[index])}`,
    '',
  );
}

describe('AnalyticsService', () => {
  it('rejects invalid and overly broad date ranges before querying PostgreSQL', async () => {
    const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    const service = new AnalyticsService({ $queryRaw: queryRaw } as unknown as PrismaService);

    await expect(
      service.dashboard({
        from: '2026-08-10',
        to: '2026-08-01',
        granularity: AnalyticsGranularity.DAY,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.dashboard({
        from: '2025-01-01',
        to: '2026-08-01',
        granularity: AnalyticsGranularity.MONTH,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('uses PostgreSQL aggregate queries for every metric family and maps their results', async () => {
    const period = new Date('2026-08-01T00:00:00.000Z');
    const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    queryRaw
      .mockResolvedValueOnce([
        {
          totalShipments: 12,
          pending: 2,
          inTransit: 3,
          outForDelivery: 1,
          delivered: 5,
          failed: 1,
          cancelled: 0,
          averageDeliveryTimeHours: 18.5,
        },
      ])
      .mockResolvedValueOnce([
        {
          totalAttempts: 7,
          successfulAttempts: 5,
          failedAttempts: 2,
          successRate: 71.4,
          firstAttemptSuccessRate: 66.7,
          averageAttemptDurationHours: 1.25,
        },
      ])
      .mockResolvedValueOnce([{ status: 'DELIVERED', count: 5 }])
      .mockResolvedValueOnce([{ period, created: 12, delivered: 5, failed: 2 }])
      .mockResolvedValueOnce([
        {
          driverId: '22222222-2222-4222-8222-222222222222',
          driverName: 'Driver A',
          employeeCode: 'DRV-001',
          totalAttempts: 7,
          delivered: 5,
          failed: 2,
          successRate: 71.4,
          averageAttemptDurationHours: 1.25,
        },
      ])
      .mockResolvedValueOnce([
        {
          warehouseId: '11111111-1111-4111-8111-111111111111',
          code: 'SGN',
          name: 'Kho Sài Gòn',
          inboundShipments: 6,
          outboundShipments: 6,
          currentInventory: 2,
          transfersDispatched: 3,
          transfersReceived: 4,
          deliveredShipments: 5,
        },
      ])
      .mockResolvedValueOnce([
        {
          reason: 'RECIPIENT_UNAVAILABLE',
          count: 2,
          affectedShipments: 1,
          percentage: 100,
          totalFailures: 2,
          totalAffectedShipments: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          transactionCount: 4,
          expectedAmount: 1_000_000,
          collectedAmount: 800_000,
          remittedAmount: 600_000,
          settledAmount: 500_000,
          unsettledAmount: 500_000,
          disputedAmount: 100_000,
        },
      ])
      .mockResolvedValueOnce([
        { id: '11111111-1111-4111-8111-111111111111', label: 'SGN · Kho Sài Gòn' },
      ])
      .mockResolvedValueOnce([
        { id: '22222222-2222-4222-8222-222222222222', label: 'Driver A · DRV-001' },
      ]);
    const service = new AnalyticsService({ $queryRaw: queryRaw } as unknown as PrismaService);

    const response = await service.dashboard({
      from: '2026-08-01',
      to: '2026-08-31',
      warehouseId: '11111111-1111-4111-8111-111111111111',
      driverId: '22222222-2222-4222-8222-222222222222',
      granularity: AnalyticsGranularity.DAY,
    });

    expect(queryRaw).toHaveBeenCalledTimes(10);
    const sql = queryRaw.mock.calls.map((call) => renderSqlCall(call)).join('\n');
    expect(sql).toContain('COUNT(');
    expect(sql).toContain('SUM(');
    expect(sql).toContain('AVG(');
    expect(sql).toContain('filtered_shipments AS');
    expect(sql).toContain('assignment."driverId"');
    expect(sql).toContain('s."originWarehouseId"');
    expect(response.overview).toMatchObject({ totalShipments: 12, deliverySuccessRate: 71.4 });
    expect(response.shipmentTrend[0]?.period).toBe(period.toISOString());
    expect(response.failedDeliveryStats).toEqual({
      totalFailures: 2,
      affectedShipments: 1,
      byReason: [
        {
          reason: 'RECIPIENT_UNAVAILABLE',
          count: 2,
          affectedShipments: 1,
          percentage: 100,
        },
      ],
    });
    expect(response.codStats.unsettledAmount).toBe(500_000);
  });
});
