import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AddressSnapshot, ContactSnapshot } from '../shipments/shipment.response.js';
import type {
  CustomerDashboardResponse,
  DashboardOverview,
  DashboardShipmentSummary,
  DispatcherDashboardResponse,
  DriverDashboardResponse,
} from './dashboard.response.js';

interface OverviewRow {
  totalShipments: number;
  pending: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
  failed: number;
  cancelled: number;
  deliverySuccessRate: number;
  averageDeliveryTimeHours: number;
}

interface CodRow {
  codCollected: number;
  codUnsettled: number;
}

interface AssignmentCountsRow {
  pending: number;
  active: number;
  completed: number;
}

interface DispatcherOperationsRow {
  awaitingPickupAssignment: number;
  awaitingDeliveryAssignment: number;
  returnRequested: number;
  returnInTransit: number;
  damagedOrLost: number;
  disputedCod: number;
}

interface DriverStatusCountsRow {
  availableDrivers: number;
  busyDrivers: number;
}

@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  async customer(customerId: string): Promise<CustomerDashboardResponse> {
    const scope = Prisma.sql`
      SELECT s.id, s.status, s."createdAt"
      FROM "Shipment" s
      WHERE s."customerId" = ${customerId}::uuid
    `;
    const [overview, recentShipments] = await Promise.all([
      this.overview(scope),
      this.recentShipments({ customerId }),
    ]);
    return { generatedAt: new Date().toISOString(), overview, recentShipments };
  }

  async driver(userId: string): Promise<DriverDashboardResponse> {
    const driver = await this.prisma.driverProfile.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException({
        code: 'DRIVER_NOT_FOUND',
        message: 'Driver profile was not found',
      });
    }
    const scope = Prisma.sql`
      SELECT DISTINCT s.id, s.status, s."createdAt"
      FROM "Shipment" s
      JOIN "DriverAssignment" assignment ON assignment."shipmentId" = s.id
      WHERE assignment."driverId" = ${driver.id}::uuid
    `;
    const [overview, assignmentRows, recentTasks] = await Promise.all([
      this.overview(scope, Prisma.sql`AND attempt."driverId" = ${driver.id}::uuid`),
      this.prisma.$queryRaw<AssignmentCountsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'PENDING')::integer AS "pending",
          COUNT(*) FILTER (WHERE status = 'ACCEPTED')::integer AS "active",
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::integer AS "completed"
        FROM "DriverAssignment"
        WHERE "driverId" = ${driver.id}::uuid
      `,
      this.prisma.driverAssignment.findMany({
        where: { driverId: driver.id },
        include: { shipment: { select: { trackingCode: true, status: true } } },
        orderBy: { assignedAt: 'desc' },
        take: 5,
      }),
    ]);
    const assignments = assignmentRows[0] ?? { pending: 0, active: 0, completed: 0 };
    return {
      generatedAt: new Date().toISOString(),
      overview,
      driver: {
        id: driver.id,
        status: driver.status,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        employeeCode: driver.employeeCode,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
      },
      assignments,
      recentTasks: recentTasks.map((task) => ({
        assignmentId: task.id,
        shipmentId: task.shipmentId,
        trackingCode: task.shipment.trackingCode,
        type: task.type,
        assignmentStatus: task.status,
        shipmentStatus: task.shipment.status,
        assignedAt: task.assignedAt,
      })),
    };
  }

  async dispatcher(): Promise<DispatcherDashboardResponse> {
    const scope = Prisma.sql`
      SELECT s.id, s.status, s."createdAt"
      FROM "Shipment" s
    `;
    const [overview, operationsRows, driverRows, recentShipments] = await Promise.all([
      this.overview(scope),
      this.prisma.$queryRaw<DispatcherOperationsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE s.status = 'AWAITING_PICKUP_ASSIGNMENT')::integer AS "awaitingPickupAssignment",
          COUNT(*) FILTER (WHERE s.status = 'AWAITING_DELIVERY_ASSIGNMENT')::integer AS "awaitingDeliveryAssignment",
          COUNT(*) FILTER (WHERE s.status = 'RETURN_REQUESTED')::integer AS "returnRequested",
          COUNT(*) FILTER (WHERE s.status = 'RETURN_IN_TRANSIT')::integer AS "returnInTransit",
          COUNT(*) FILTER (WHERE s.status::text IN ('DAMAGED', 'LOST'))::integer AS "damagedOrLost",
          (SELECT COUNT(*)::integer FROM "CODTransaction" cod WHERE cod.status = 'DISPUTED') AS "disputedCod"
        FROM "Shipment" s
      `,
      this.prisma.$queryRaw<DriverStatusCountsRow[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE dp.status = 'AVAILABLE' AND dp."isOnline" = true AND dp."isAvailable" = true
              AND u.status = 'ACTIVE'
          )::integer AS "availableDrivers",
          COUNT(*) FILTER (WHERE dp.status = 'BUSY' AND u.status = 'ACTIVE')::integer AS "busyDrivers"
        FROM "DriverProfile" dp
        JOIN "User" u ON u.id = dp."userId"
      `,
      this.recentShipments({}),
    ]);
    const operations = operationsRows[0] ?? {
      awaitingPickupAssignment: 0,
      awaitingDeliveryAssignment: 0,
      returnRequested: 0,
      returnInTransit: 0,
      damagedOrLost: 0,
      disputedCod: 0,
    };
    const drivers = driverRows[0] ?? { availableDrivers: 0, busyDrivers: 0 };
    return {
      generatedAt: new Date().toISOString(),
      overview,
      operations: { ...operations, ...drivers },
      recentShipments,
    };
  }

  private async overview(scope: Prisma.Sql, attemptFilter: Prisma.Sql = Prisma.empty) {
    const [overviewRows, codRows] = await Promise.all([
      this.prisma.$queryRaw<OverviewRow[]>`
        WITH scoped_shipments AS (${scope}), delivered_shipments AS (
          SELECT attempt."shipmentId", MAX(attempt."completedAt") AS "deliveredAt"
          FROM "DeliveryAttempt" attempt
          JOIN scoped_shipments scoped ON scoped.id = attempt."shipmentId"
          WHERE attempt.status = 'DELIVERED' ${attemptFilter}
          GROUP BY attempt."shipmentId"
        ), attempt_totals AS (
          SELECT
            COUNT(*) FILTER (WHERE attempt.status = 'DELIVERED')::integer AS delivered,
            COUNT(*) FILTER (WHERE attempt.status = 'FAILED')::integer AS failed
          FROM "DeliveryAttempt" attempt
          JOIN scoped_shipments scoped ON scoped.id = attempt."shipmentId"
          WHERE attempt.status IN ('DELIVERED', 'FAILED') ${attemptFilter}
        )
        SELECT
          COUNT(*)::integer AS "totalShipments",
          COUNT(*) FILTER (WHERE scoped.status = 'PENDING')::integer AS "pending",
          COUNT(*) FILTER (WHERE scoped.status = 'IN_TRANSIT')::integer AS "inTransit",
          COUNT(*) FILTER (WHERE scoped.status = 'OUT_FOR_DELIVERY')::integer AS "outForDelivery",
          COUNT(*) FILTER (WHERE scoped.status = 'DELIVERED')::integer AS "delivered",
          COUNT(*) FILTER (WHERE scoped.status = 'DELIVERY_FAILED')::integer AS "failed",
          COUNT(*) FILTER (WHERE scoped.status = 'CANCELLED')::integer AS "cancelled",
          ROUND(
            CASE WHEN attempts.delivered + attempts.failed = 0 THEN 0
              ELSE attempts.delivered * 100.0 / (attempts.delivered + attempts.failed) END,
            1
          )::double precision AS "deliverySuccessRate",
          ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (delivered."deliveredAt" - scoped."createdAt")) / 3600), 0)::numeric, 2)::double precision AS "averageDeliveryTimeHours"
        FROM scoped_shipments scoped
        LEFT JOIN delivered_shipments delivered ON delivered."shipmentId" = scoped.id
        CROSS JOIN attempt_totals attempts
        GROUP BY attempts.delivered, attempts.failed
      `,
      this.prisma.$queryRaw<CodRow[]>`
        WITH scoped_shipments AS (${scope})
        SELECT
          COALESCE(SUM(cod."collectedAmount"), 0)::double precision AS "codCollected",
          COALESCE(SUM(cod."expectedAmount") FILTER (WHERE cod.status <> 'SETTLED'), 0)::double precision AS "codUnsettled"
        FROM "CODTransaction" cod
        JOIN scoped_shipments scoped ON scoped.id = cod."shipmentId"
      `,
    ]);
    const overview = overviewRows[0] ?? this.emptyOverview();
    const cod = codRows[0] ?? { codCollected: 0, codUnsettled: 0 };
    return { ...overview, ...cod } satisfies DashboardOverview;
  }

  private async recentShipments(where: Prisma.ShipmentWhereInput) {
    const shipments = await this.prisma.shipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        trackingCode: true,
        status: true,
        receiverSnapshot: true,
        deliverySnapshot: true,
        createdAt: true,
      },
    });
    return shipments.map((shipment): DashboardShipmentSummary => {
      const receiver = shipment.receiverSnapshot as unknown as ContactSnapshot;
      const delivery = shipment.deliverySnapshot as unknown as AddressSnapshot;
      return {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        status: shipment.status,
        receiverName: receiver.fullName,
        deliveryCity: delivery.city,
        createdAt: shipment.createdAt,
      };
    });
  }

  private emptyOverview(): OverviewRow {
    return {
      totalShipments: 0,
      pending: 0,
      inTransit: 0,
      outForDelivery: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      deliverySuccessRate: 0,
      averageDeliveryTimeHours: 0,
    };
  }
}
