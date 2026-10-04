// Read-only, opt-in preflight. Never loads .env implicitly or changes enforcement.
// Build backend first. Supply READINESS_DATABASE_URL and route/window/smoke arguments.
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { LineHaulPolicy } from '../dist/modules/line-haul/line-haul.policy.js';
import { activeAssignmentStatuses } from '../dist/modules/assignments/assignment.policy.js';
import { executingLineHaulTripStatuses } from '../dist/modules/line-haul/line-haul.constants.js';
import { parseLineHaulEnforcementFrom } from '../dist/config/line-haul-enforcement.js';

const [originWarehouseId, destinationWarehouseId, start, end, smokeTripId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
if (!process.env.READINESS_DATABASE_URL || !uuid.test(originWarehouseId ?? '') ||
    !uuid.test(destinationWarehouseId ?? '') || (smokeTripId && !uuid.test(smokeTripId))) {
  throw new Error('Set READINESS_DATABASE_URL; arguments: origin UUID, destination UUID, window start/end UTC, optional completed smoke trip UUID');
}
const scheduledStartAt = parseLineHaulEnforcementFrom(start);
const scheduledEndAt = parseLineHaulEnforcementFrom(end);
if (!scheduledStartAt || !scheduledEndAt || scheduledEndAt <= scheduledStartAt) throw new Error('A valid UTC schedule window is required');
const policy = new LineHaulPolicy();
policy.assertDistinctWarehouses(originWarehouseId, destinationWarehouseId);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.READINESS_DATABASE_URL, connectionTimeoutMillis: 10_000 }) });
try {
  const report = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const warehouses = await tx.warehouse.findMany({
      where: { id: { in: [originWarehouseId, destinationWarehouseId] } },
      select: { id: true, code: true, isActive: true, staffProfiles: {
        where: { isActive: true, user: { role: 'WAREHOUSE_STAFF', status: 'ACTIVE' } }, select: { id: true },
      } },
    });
    const conflictingTrips = { OR: [
      { status: { in: executingLineHaulTripStatuses } },
      { status: 'PLANNED', scheduledStartAt: { lt: scheduledEndAt }, scheduledEndAt: { gt: scheduledStartAt } },
    ] };
    const drivers = await tx.driverProfile.findMany({
      where: { assignments: { none: { status: { in: activeAssignmentStatuses } } }, lineHaulTrips: { none: conflictingTrips } },
      select: { id: true, employeeCode: true, status: true, capabilities: true, user: { select: { role: true, status: true } } },
    });
    const vehicles = await tx.lineHaulVehicle.findMany({
      where: { trips: { none: conflictingTrips } },
      select: { id: true, vehicleCode: true, status: true, capacityWeightGrams: true },
    });
    const eligibleDrivers = drivers.filter((driver) => {
      try { policy.assertDriverEligible(driver); return true; }
      catch (error) { if (error.getStatus?.() === 409) return false; throw error; }
    });
    const eligibleVehicles = vehicles.filter((vehicle) => {
      try { policy.assertVehicleEligible(vehicle); return true; }
      catch (error) { if ([400, 409].includes(error.getStatus?.())) return false; throw error; }
    });
    const managers = await tx.user.count({ where: { role: { in: ['ADMIN', 'DISPATCHER'] }, status: 'ACTIVE' } });
    const standaloneInTransit = await tx.warehouseTransfer.findMany({
      where: { status: 'IN_TRANSIT', lineHaulTripAssignments: { none: { isActive: true } } },
      select: { transferCode: true, dispatchedAt: true, fromWarehouseId: true, toWarehouseId: true },
    });
    const pendingRoutes = await tx.warehouseTransfer.groupBy({
      by: ['fromWarehouseId', 'toWarehouseId'], where: { status: 'PENDING' }, _count: true,
    });
    const smoke = smokeTripId ? await tx.lineHaulTrip.findUnique({
      where: { id: smokeTripId }, select: { tripCode: true, status: true, originWarehouseId: true, destinationWarehouseId: true,
        departedAt: true, arrivedAt: true, scheduledStartAt: true, scheduledEndAt: true,
        preparedManifestWeightGrams: true, preparedVehicleCapacityWeightGrams: true,
        transferAssignments: { where: { isActive: true }, select: { warehouseTransfer: { select: { status: true, receivedAt: true } } } },
      },
    }) : null;
    const blockers = [];
    if (warehouses.length !== 2 || warehouses.some((w) => !w.isActive)) blockers.push('Two active route warehouses required');
    if (warehouses.some((w) => !w.staffProfiles.length)) blockers.push('Active WAREHOUSE_STAFF at both warehouses required');
    if (!managers) blockers.push('Active Dispatcher/Admin required');
    if (!eligibleDrivers.length) blockers.push('Eligible LINE_HAUL driver free in the proposed window required');
    if (!eligibleVehicles.length) blockers.push('AVAILABLE positive-capacity vehicle free in the proposed window required');
    if (standaloneInTransit.some((t) => !t.dispatchedAt)) blockers.push('Standalone IN_TRANSIT without departure evidence requires investigation');
    if (!smoke || smoke.status !== 'ARRIVED' || !smoke.departedAt || !smoke.arrivedAt ||
        smoke.originWarehouseId !== originWarehouseId || smoke.destinationWarehouseId !== destinationWarehouseId ||
        !smoke.scheduledStartAt || !smoke.scheduledEndAt || !smoke.preparedManifestWeightGrams ||
        !smoke.preparedVehicleCapacityWeightGrams || !smoke.transferAssignments.length ||
        smoke.transferAssignments.some((a) => a.warehouseTransfer.status !== 'COMPLETED' || !a.warehouseTransfer.receivedAt)) {
      blockers.push('Real scheduled A-to-B trip with READY capacity snapshots, departure, ARRIVED and completed receive required');
    }
    return { readOnly: true, checkedAt: new Date().toISOString(), databaseChecksPass: blockers.length === 0, blockers,
      route: { originWarehouseId, destinationWarehouseId, scheduledStartAt, scheduledEndAt },
      warehouses: warehouses.map(({ staffProfiles, ...w }) => ({ ...w, activeStaff: staffProfiles.length })),
      eligibleDrivers: eligibleDrivers.map(({ id, employeeCode }) => ({ id, employeeCode })), eligibleVehicles,
      standaloneInTransit, pendingRoutes, smokeTripCode: smoke?.tripCode ?? null,
      manualGates: ['Verify owned trip GPS via real API/Redis/Socket during smoke (GPS is not durable evidence)',
        'Verify capacity and readiness for EVERY active warehouse route before global cutover',
        'Drain standalone dispatch requests and switch all API instances to the SAME stable cutover',
        'Choose cutover after all compatibility departures; preserve it across restarts/rollback'],
      enforcementChanged: false,
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.databaseChecksPass ? 0 : 2;
} catch (error) {
  // Database errors can contain connection details; retain only the error type/code.
  console.error('Readiness check failed', error.code ?? error.name);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
