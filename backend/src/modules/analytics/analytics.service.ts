import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AnalyticsGranularity, AnalyticsQueryDto } from './dto/analytics-query.dto.js';

interface AnalyticsRange {
  from: Date;
  to: Date;
  toExclusive: Date;
}

export interface ShipmentMetricsRow {
  totalShipments: number;
  pending: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
  failed: number;
  cancelled: number;
  averageDeliveryTimeHours: number;
}

export interface DeliveryPerformanceRow {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  successRate: number;
  firstAttemptSuccessRate: number;
  averageAttemptDurationHours: number;
}

export interface StatusBreakdownRow {
  status: string;
  count: number;
}

export interface TrendRow {
  period: Date;
  created: number;
  delivered: number;
  failed: number;
}

export interface DriverPerformanceRow {
  driverId: string;
  driverName: string;
  employeeCode: string;
  totalAttempts: number;
  delivered: number;
  failed: number;
  successRate: number;
  averageAttemptDurationHours: number;
}

export interface WarehouseStatsRow {
  warehouseId: string;
  code: string;
  name: string;
  inboundShipments: number;
  outboundShipments: number;
  currentInventory: number;
  transfersDispatched: number;
  transfersReceived: number;
  deliveredShipments: number;
}

export interface FailedDeliveryRow {
  reason: string;
  count: number;
  affectedShipments: number;
  percentage: number;
  totalFailures: number;
  totalAffectedShipments: number;
}

export interface CodStatsRow {
  transactionCount: number;
  expectedAmount: number;
  collectedAmount: number;
  remittedAmount: number;
  settledAmount: number;
  unsettledAmount: number;
  disputedAmount: number;
}

export interface FilterOptionRow {
  id: string;
  label: string;
}

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(query: AnalyticsQueryDto) {
    const range = this.resolveRange(query);
    const shipmentScope = this.filteredShipments(query, range);
    const bucketInterval = this.bucketInterval(query.granularity);

    const [
      shipmentMetrics,
      deliveryPerformance,
      statusBreakdown,
      shipmentTrend,
      driverPerformance,
      warehouseStats,
      failedDeliveryStats,
      codStats,
      warehouses,
      drivers,
    ] = await Promise.all([
      this.prisma.$queryRaw<ShipmentMetricsRow[]>`
        WITH ${shipmentScope}, delivered_shipments AS (
          SELECT da."shipmentId", MAX(da."completedAt") AS "deliveredAt"
          FROM "DeliveryAttempt" da
          JOIN filtered_shipments fs ON fs.id = da."shipmentId"
          WHERE da.status = 'DELIVERED'
          GROUP BY da."shipmentId"
        )
        SELECT
          COUNT(*)::integer AS "totalShipments",
          COUNT(*) FILTER (WHERE fs.status = 'PENDING')::integer AS "pending",
          COUNT(*) FILTER (WHERE fs.status = 'IN_TRANSIT')::integer AS "inTransit",
          COUNT(*) FILTER (WHERE fs.status = 'OUT_FOR_DELIVERY')::integer AS "outForDelivery",
          COUNT(*) FILTER (WHERE fs.status = 'DELIVERED')::integer AS "delivered",
          COUNT(*) FILTER (WHERE fs.status = 'DELIVERY_FAILED')::integer AS "failed",
          COUNT(*) FILTER (WHERE fs.status = 'CANCELLED')::integer AS "cancelled",
          ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (ds."deliveredAt" - fs."createdAt")) / 3600), 0)::numeric, 2)::double precision AS "averageDeliveryTimeHours"
        FROM filtered_shipments fs
        LEFT JOIN delivered_shipments ds ON ds."shipmentId" = fs.id
      `,
      this.prisma.$queryRaw<DeliveryPerformanceRow[]>`
        WITH ${shipmentScope}
        SELECT
          COUNT(*)::integer AS "totalAttempts",
          COUNT(*) FILTER (WHERE da.status = 'DELIVERED')::integer AS "successfulAttempts",
          COUNT(*) FILTER (WHERE da.status = 'FAILED')::integer AS "failedAttempts",
          ROUND(CASE WHEN COUNT(*) FILTER (WHERE da.status IN ('DELIVERED', 'FAILED')) = 0 THEN 0
            ELSE COUNT(*) FILTER (WHERE da.status = 'DELIVERED') * 100.0 /
              COUNT(*) FILTER (WHERE da.status IN ('DELIVERED', 'FAILED')) END, 1)::double precision AS "successRate",
          ROUND(CASE WHEN COUNT(*) FILTER (WHERE da."attemptNumber" = 1 AND da.status IN ('DELIVERED', 'FAILED')) = 0 THEN 0
            ELSE COUNT(*) FILTER (WHERE da."attemptNumber" = 1 AND da.status = 'DELIVERED') * 100.0 /
              COUNT(*) FILTER (WHERE da."attemptNumber" = 1 AND da.status IN ('DELIVERED', 'FAILED')) END, 1)::double precision AS "firstAttemptSuccessRate",
          ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (da."completedAt" - da."startedAt")) / 3600)
            FILTER (WHERE da."completedAt" IS NOT NULL), 0)::numeric, 2)::double precision AS "averageAttemptDurationHours"
        FROM "DeliveryAttempt" da
        JOIN filtered_shipments fs ON fs.id = da."shipmentId"
      `,
      this.prisma.$queryRaw<StatusBreakdownRow[]>`
        WITH ${shipmentScope}
        SELECT fs.status::text AS "status", COUNT(*)::integer AS "count"
        FROM filtered_shipments fs
        GROUP BY fs.status
        ORDER BY COUNT(*) DESC, fs.status
      `,
      this.prisma.$queryRaw<TrendRow[]>`
        WITH ${shipmentScope}, buckets AS (
          SELECT generate_series(
            date_trunc(${query.granularity}, ${range.from}::timestamptz),
            date_trunc(${query.granularity}, ${range.to}::timestamptz),
            ${bucketInterval}::interval
          ) AS period
        ), created_series AS (
          SELECT date_trunc(${query.granularity}, fs."createdAt") AS period, COUNT(*)::integer AS count
          FROM filtered_shipments fs GROUP BY 1
        ), delivered_series AS (
          SELECT date_trunc(${query.granularity}, da."completedAt") AS period, COUNT(*)::integer AS count
          FROM "DeliveryAttempt" da JOIN filtered_shipments fs ON fs.id = da."shipmentId"
          WHERE da.status = 'DELIVERED' AND da."completedAt" >= ${range.from} AND da."completedAt" < ${range.toExclusive}
          GROUP BY 1
        ), failed_series AS (
          SELECT date_trunc(${query.granularity}, da."completedAt") AS period, COUNT(*)::integer AS count
          FROM "DeliveryAttempt" da JOIN filtered_shipments fs ON fs.id = da."shipmentId"
          WHERE da.status = 'FAILED' AND da."completedAt" >= ${range.from} AND da."completedAt" < ${range.toExclusive}
          GROUP BY 1
        )
        SELECT b.period,
          COALESCE(cs.count, 0)::integer AS "created",
          COALESCE(ds.count, 0)::integer AS "delivered",
          COALESCE(fs.count, 0)::integer AS "failed"
        FROM buckets b
        LEFT JOIN created_series cs ON cs.period = b.period
        LEFT JOIN delivered_series ds ON ds.period = b.period
        LEFT JOIN failed_series fs ON fs.period = b.period
        ORDER BY b.period
      `,
      this.prisma.$queryRaw<DriverPerformanceRow[]>`
        WITH ${shipmentScope}
        SELECT dp.id AS "driverId", u."fullName" AS "driverName", dp."employeeCode",
          COUNT(da.id)::integer AS "totalAttempts",
          COUNT(da.id) FILTER (WHERE da.status = 'DELIVERED')::integer AS "delivered",
          COUNT(da.id) FILTER (WHERE da.status = 'FAILED')::integer AS "failed",
          ROUND(CASE WHEN COUNT(da.id) FILTER (WHERE da.status IN ('DELIVERED', 'FAILED')) = 0 THEN 0
            ELSE COUNT(da.id) FILTER (WHERE da.status = 'DELIVERED') * 100.0 /
              COUNT(da.id) FILTER (WHERE da.status IN ('DELIVERED', 'FAILED')) END, 1)::double precision AS "successRate",
          ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (da."completedAt" - da."startedAt")) / 3600)
            FILTER (WHERE da."completedAt" IS NOT NULL), 0)::numeric, 2)::double precision AS "averageAttemptDurationHours"
        FROM "DeliveryAttempt" da
        JOIN filtered_shipments fs ON fs.id = da."shipmentId"
        JOIN "DriverProfile" dp ON dp.id = da."driverId"
        JOIN "User" u ON u.id = dp."userId"
        GROUP BY dp.id, u."fullName", dp."employeeCode"
        ORDER BY "delivered" DESC, "successRate" DESC, u."fullName"
        LIMIT 20
      `,
      this.prisma.$queryRaw<WarehouseStatsRow[]>`
        WITH ${shipmentScope}, origin_stats AS (
          SELECT fs."originWarehouseId" AS id, COUNT(*)::integer AS count
          FROM filtered_shipments fs WHERE fs."originWarehouseId" IS NOT NULL GROUP BY 1
        ), destination_stats AS (
          SELECT fs."destinationWarehouseId" AS id, COUNT(*)::integer AS count,
            COUNT(*) FILTER (WHERE fs.status = 'DELIVERED')::integer AS delivered
          FROM filtered_shipments fs WHERE fs."destinationWarehouseId" IS NOT NULL GROUP BY 1
        ), inventory_stats AS (
          SELECT fs."currentWarehouseId" AS id, COUNT(*)::integer AS count
          FROM filtered_shipments fs WHERE fs."currentWarehouseId" IS NOT NULL GROUP BY 1
        ), transfer_out_stats AS (
          SELECT wt."fromWarehouseId" AS id, COUNT(*)::integer AS count
          FROM "WarehouseTransfer" wt JOIN filtered_shipments fs ON fs.id = wt."shipmentId" GROUP BY 1
        ), transfer_in_stats AS (
          SELECT wt."toWarehouseId" AS id, COUNT(*) FILTER (WHERE wt.status = 'COMPLETED')::integer AS count
          FROM "WarehouseTransfer" wt JOIN filtered_shipments fs ON fs.id = wt."shipmentId" GROUP BY 1
        )
        SELECT w.id AS "warehouseId", w.code, w.name,
          COALESCE(ds.count, 0)::integer AS "inboundShipments",
          COALESCE(os.count, 0)::integer AS "outboundShipments",
          COALESCE(ins.count, 0)::integer AS "currentInventory",
          COALESCE(tos.count, 0)::integer AS "transfersDispatched",
          COALESCE(tis.count, 0)::integer AS "transfersReceived",
          COALESCE(ds.delivered, 0)::integer AS "deliveredShipments"
        FROM "Warehouse" w
        LEFT JOIN origin_stats os ON os.id = w.id
        LEFT JOIN destination_stats ds ON ds.id = w.id
        LEFT JOIN inventory_stats ins ON ins.id = w.id
        LEFT JOIN transfer_out_stats tos ON tos.id = w.id
        LEFT JOIN transfer_in_stats tis ON tis.id = w.id
        WHERE (${query.warehouseId ?? null}::uuid IS NULL OR w.id = ${query.warehouseId ?? null}::uuid)
          AND (COALESCE(ds.count, 0) + COALESCE(os.count, 0) + COALESCE(ins.count, 0) + COALESCE(tos.count, 0) + COALESCE(tis.count, 0)) > 0
        ORDER BY "currentInventory" DESC, (COALESCE(ds.count, 0) + COALESCE(os.count, 0)) DESC, w.name
      `,
      this.prisma.$queryRaw<FailedDeliveryRow[]>`
        WITH ${shipmentScope}, failures AS (
          SELECT da."shipmentId", COALESCE(da."failureReason"::text, 'OTHER') AS reason
          FROM "DeliveryAttempt" da JOIN filtered_shipments fs ON fs.id = da."shipmentId"
          WHERE da.status = 'FAILED'
        ), totals AS (
          SELECT COUNT(*)::integer AS "totalFailures",
            COUNT(DISTINCT failures."shipmentId")::integer AS "totalAffectedShipments"
          FROM failures
        )
        SELECT f.reason,
          COUNT(*)::integer AS "count",
          COUNT(DISTINCT f."shipmentId")::integer AS "affectedShipments",
          ROUND(CASE WHEN SUM(COUNT(*)) OVER () = 0 THEN 0
            ELSE COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () END, 1)::double precision AS "percentage",
          totals."totalFailures", totals."totalAffectedShipments"
        FROM failures f
        CROSS JOIN totals
        GROUP BY f.reason
          , totals."totalFailures", totals."totalAffectedShipments"
        ORDER BY "count" DESC, f.reason
      `,
      this.prisma.$queryRaw<CodStatsRow[]>`
        WITH ${shipmentScope}
        SELECT
          COUNT(ct.id)::integer AS "transactionCount",
          COALESCE(SUM(ct."expectedAmount"), 0)::double precision AS "expectedAmount",
          COALESCE(SUM(ct."collectedAmount"), 0)::double precision AS "collectedAmount",
          COALESCE(SUM(ct."remittedAmount"), 0)::double precision AS "remittedAmount",
          COALESCE(SUM(ct."expectedAmount") FILTER (WHERE ct.status = 'SETTLED'), 0)::double precision AS "settledAmount",
          COALESCE(SUM(ct."expectedAmount") FILTER (WHERE ct.status <> 'SETTLED'), 0)::double precision AS "unsettledAmount",
          COALESCE(SUM(ct."expectedAmount") FILTER (WHERE ct.status = 'DISPUTED'), 0)::double precision AS "disputedAmount"
        FROM "CODTransaction" ct
        JOIN filtered_shipments fs ON fs.id = ct."shipmentId"
      `,
      this.prisma.$queryRaw<FilterOptionRow[]>`
        SELECT w.id, CONCAT(w.code, ' · ', w.name) AS label
        FROM "Warehouse" w ORDER BY w."isActive" DESC, w.name
      `,
      this.prisma.$queryRaw<FilterOptionRow[]>`
        SELECT dp.id, CONCAT(u."fullName", ' · ', dp."employeeCode") AS label
        FROM "DriverProfile" dp JOIN "User" u ON u.id = dp."userId"
        ORDER BY (u.status = 'ACTIVE') DESC, u."fullName"
      `,
    ]);

    const overview = shipmentMetrics[0] ?? this.emptyShipmentMetrics();
    const delivery = deliveryPerformance[0] ?? this.emptyDeliveryPerformance();

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        from: this.dateOnly(range.from),
        to: this.dateOnly(range.to),
        warehouseId: query.warehouseId ?? null,
        driverId: query.driverId ?? null,
        granularity: query.granularity,
      },
      filterOptions: { warehouses, drivers },
      overview: {
        ...overview,
        deliverySuccessRate: delivery.successRate,
      },
      deliveryPerformance: delivery,
      statusBreakdown,
      shipmentTrend: shipmentTrend.map((item) => ({
        ...item,
        period: item.period.toISOString(),
      })),
      driverPerformance,
      warehouseStats,
      failedDeliveryStats: this.failedDeliveryResponse(failedDeliveryStats),
      codStats: codStats[0] ?? this.emptyCodStats(),
    };
  }

  private filteredShipments(query: AnalyticsQueryDto, range: AnalyticsRange): Prisma.Sql {
    const warehouseFilter = query.warehouseId
      ? Prisma.sql`AND (
          s."originWarehouseId" = ${query.warehouseId}::uuid OR
          s."destinationWarehouseId" = ${query.warehouseId}::uuid OR
          s."currentWarehouseId" = ${query.warehouseId}::uuid OR
          s."returnWarehouseId" = ${query.warehouseId}::uuid
        )`
      : Prisma.empty;
    const driverFilter = query.driverId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "DriverAssignment" assignment
          WHERE assignment."shipmentId" = s.id AND assignment."driverId" = ${query.driverId}::uuid
        )`
      : Prisma.empty;

    return Prisma.sql`filtered_shipments AS (
      SELECT s.id, s.status, s."createdAt", s."originWarehouseId", s."destinationWarehouseId",
        s."currentWarehouseId", s."returnWarehouseId"
      FROM "Shipment" s
      WHERE s."createdAt" >= ${range.from} AND s."createdAt" < ${range.toExclusive}
      ${warehouseFilter}
      ${driverFilter}
    )`;
  }

  private resolveRange(query: AnalyticsQueryDto): AnalyticsRange {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const defaultFrom = new Date(today.getTime() - 29 * DAY_MS);
    const from = query.from ? this.parseDate(query.from, 'from') : defaultFrom;
    const to = query.to ? this.parseDate(query.to, 'to') : today;

    if (from > to) {
      throw new BadRequestException({
        code: 'ANALYTICS_DATE_RANGE_INVALID',
        message: 'Analytics start date must not be after the end date',
      });
    }
    if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'ANALYTICS_DATE_RANGE_TOO_LARGE',
        message: `Analytics date range cannot exceed ${MAX_RANGE_DAYS} days`,
      });
    }

    return { from, to, toExclusive: new Date(to.getTime() + DAY_MS) };
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || this.dateOnly(date) !== value) {
      throw new BadRequestException({
        code: 'ANALYTICS_DATE_INVALID',
        message: `Analytics ${field} date is invalid`,
      });
    }
    return date;
  }

  private bucketInterval(granularity: AnalyticsGranularity): string {
    if (granularity === AnalyticsGranularity.MONTH) return '1 month';
    if (granularity === AnalyticsGranularity.WEEK) return '1 week';
    return '1 day';
  }

  private dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private emptyShipmentMetrics(): ShipmentMetricsRow {
    return {
      totalShipments: 0,
      pending: 0,
      inTransit: 0,
      outForDelivery: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      averageDeliveryTimeHours: 0,
    };
  }

  private emptyDeliveryPerformance(): DeliveryPerformanceRow {
    return {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      successRate: 0,
      firstAttemptSuccessRate: 0,
      averageAttemptDurationHours: 0,
    };
  }

  private emptyCodStats(): CodStatsRow {
    return {
      transactionCount: 0,
      expectedAmount: 0,
      collectedAmount: 0,
      remittedAmount: 0,
      settledAmount: 0,
      unsettledAmount: 0,
      disputedAmount: 0,
    };
  }

  private failedDeliveryResponse(rows: FailedDeliveryRow[]) {
    const first = rows[0];
    return {
      totalFailures: first?.totalFailures ?? 0,
      affectedShipments: first?.totalAffectedShipments ?? 0,
      byReason: rows.map((item) => ({
        reason: item.reason,
        count: item.count,
        affectedShipments: item.affectedShipments,
        percentage: item.percentage,
      })),
    };
  }
}
