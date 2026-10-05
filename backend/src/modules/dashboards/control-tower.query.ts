import { Prisma } from '../../generated/prisma/client.js';
import type { ControlTowerQueryDto } from './control-tower-query.dto.js';
import {
  EXCEPTION_STATUSES,
  SHIPMENT_STAGES,
  type ControlTowerPolicy,
} from './control-tower.policy.js';

/** One parameterized statement: one PostgreSQL snapshot/clock, bounded result, no per-row API queries. */
export function controlTowerQuery(
  query: ControlTowerQueryDto,
  policy: ControlTowerPolicy,
  testClock?: Date,
): Prisma.Sql {
  const mappings = Prisma.join(
    Object.entries(SHIPMENT_STAGES).map(([status, stage]) => Prisma.sql`(${status}, ${stage})`),
  );
  const budgets = Prisma.join(
    Object.entries(policy.durationMinutes).map(
      ([stage, minutes]) => Prisma.sql`(${stage}, ${minutes}::integer)`,
    ),
  );
  const scope = (alias: 's' | 't', type: 'SHIPMENT' | 'TRIP') => {
    // Identifiers are internal constants; all user-supplied values remain parameters.
    const a = Prisma.raw(alias);
    const parts: Prisma.Sql[] = [
      Prisma.sql`${query.entityType === 'ALL' || query.entityType === type}`,
    ];
    if (query.status) parts.push(Prisma.sql`${a}.status::text = ${query.status}`);
    if (query.from) parts.push(Prisma.sql`${a}."createdAt" >= ${new Date(query.from)}`);
    if (query.to) parts.push(Prisma.sql`${a}."createdAt" < ${new Date(query.to)}`);
    if (query.warehouseId) {
      parts.push(Prisma.sql`(${a}."originWarehouseId" = ${query.warehouseId}::uuid
        OR ${a}."destinationWarehouseId" = ${query.warehouseId}::uuid
        ${
          type === 'SHIPMENT'
            ? Prisma.sql`OR s."currentWarehouseId" = ${query.warehouseId}::uuid
          OR s."returnWarehouseId" = ${query.warehouseId}::uuid`
            : Prisma.empty
        })`);
    }
    return Prisma.join(parts, ' AND ');
  };
  const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.stage) filters.push(Prisma.sql`stage = ${query.stage}`);
  if (query.slaState)
    filters.push(
      query.slaState === 'UNAVAILABLE'
        ? Prisma.sql`"slaState" IS NULL`
        : Prisma.sql`"slaState" = ${query.slaState}`,
    );
  if (query.exceptionsOnly === 'true') filters.push(Prisma.sql`exception IS NOT NULL`);
  if (query.search?.trim())
    filters.push(
      Prisma.sql`strpos(lower(concat_ws(' ', code, "transferCode", "tripCode")), lower(${query.search.trim()})) > 0`,
    );
  const orders = {
    PRIORITY: Prisma.sql`priority ASC, CASE WHEN "slaState" IN ('OVERDUE', 'AT_RISK') THEN deadline END ASC NULLS LAST, "agingSeconds" DESC NULLS LAST`,
    AGING_DESC: Prisma.sql`"agingSeconds" DESC NULLS LAST`,
    DEADLINE_ASC: Prisma.sql`deadline ASC NULLS LAST`,
    CREATED_DESC: Prisma.sql`"createdAt" DESC`,
    CODE_ASC: Prisma.sql`code ASC`,
  };
  return Prisma.sql`
    WITH clock AS (SELECT ${testClock ? Prisma.sql`${testClock}::timestamptz` : Prisma.sql`statement_timestamp()`} AS "asOf"),
    stage_map(status, stage) AS (VALUES ${mappings}),
    budgets(stage, minutes) AS (VALUES ${budgets}),
    shipment_scope AS (
      SELECT s.id, s."trackingCode", s.status, s."createdAt", s."confirmedAt",
        s."originWarehouseId", s."destinationWarehouseId", s."currentWarehouseId", m.stage
      FROM "Shipment" s JOIN stage_map m ON m.status = s.status::text
      WHERE m.stage <> 'TERMINAL' AND ${scope('s', 'SHIPMENT')}
    ), trip_scope AS (
      SELECT t.id, t."tripCode", t.status, t."createdAt", t."departedAt",
        t."originWarehouseId", t."destinationWarehouseId" FROM "LineHaulTrip" t
      WHERE t.status IN ('PLANNED', 'READY', 'IN_TRANSIT') AND ${scope('t', 'TRIP')}
    ), raw AS (
      SELECT s.id, 'SHIPMENT'::text AS "entityType", s."trackingCode" AS code,
        s.status::text AS status, s.stage, s."createdAt",
        CASE WHEN s.stage = 'PENDING' THEN s."createdAt"
          WHEN s.stage = 'PICKUP' THEN COALESCE(s."confirmedAt", entry.started)
          WHEN s.stage = 'TRANSIT' THEN COALESCE(tr."dispatchedAt", entry.started)
          WHEN s.stage = 'DELIVERY' THEN COALESCE(attempt."startedAt", entry.started)
          ELSE entry.started END AS started,
        CASE WHEN s.stage = 'PENDING' OR (s.stage = 'PICKUP' AND s."confirmedAt" IS NOT NULL)
          OR (s.stage = 'TRANSIT' AND tr."dispatchedAt" IS NOT NULL)
          OR (s.stage = 'DELIVERY' AND attempt."startedAt" IS NOT NULL)
          THEN 'LIFECYCLE' ELSE 'TRACKING' END AS source,
        COALESCE(history.bad, false) OR (history.latest IS NOT NULL AND
          (history."currentStatusAt" IS NULL OR history."currentStatusAt" < history.latest))
          OR (history.boundary IS NOT NULL AND entry.started IS NULL) AS inconsistent,
        CASE WHEN s.status::text IN (${Prisma.join(EXCEPTION_STATUSES)}) THEN s.status::text
          WHEN s.stage = 'TRANSIT' AND tr.id IS NULL THEN 'MISSING_ACTIVE_TRANSFER'
          ELSE NULL END AS "domainException",
        s."originWarehouseId", s."destinationWarehouseId", s."currentWarehouseId",
        tr.id AS "transferId", tr."transferCode", tr."fromWarehouseId" AS "transferWarehouseId",
        link."tripId", link."tripCode"
      FROM shipment_scope s CROSS JOIN clock
      LEFT JOIN LATERAL (
        SELECT max(e."createdAt") AS latest,
          max(e."createdAt") FILTER (WHERE e.status = s.status) AS "currentStatusAt",
          max(e."createdAt") FILTER (WHERE m.stage <> s.stage) AS boundary,
          bool_or(e."createdAt" > clock."asOf" OR e."createdAt" < s."createdAt") AS bad
        FROM "TrackingEvent" e JOIN stage_map m ON m.status = e.status::text
        WHERE e."shipmentId" = s.id
      ) history ON true
      LEFT JOIN LATERAL (
        SELECT min(e."createdAt") AS started
        FROM "TrackingEvent" e JOIN stage_map m ON m.status = e.status::text
        WHERE e."shipmentId" = s.id AND m.stage = s.stage
          AND e."createdAt" > COALESCE(history.boundary, '-infinity'::timestamptz)
      ) entry ON true
      LEFT JOIN LATERAL (
        SELECT wt.id, wt."transferCode", wt."fromWarehouseId", wt."dispatchedAt"
        FROM "WarehouseTransfer" wt WHERE wt."shipmentId" = s.id AND wt.status IN ('PENDING', 'IN_TRANSIT')
        ORDER BY wt."createdAt" DESC, wt.id LIMIT 1
      ) tr ON true
      LEFT JOIN LATERAL (
        SELECT t.id AS "tripId", t."tripCode"
        FROM "LineHaulTripTransfer" l JOIN "LineHaulTrip" t ON t.id = l."tripId"
        WHERE l."warehouseTransferId" = tr.id AND l."isActive" LIMIT 1
      ) link ON true
      LEFT JOIN LATERAL (
        SELECT da."startedAt" FROM "DeliveryAttempt" da
        WHERE da."shipmentId" = s.id AND da.status = 'OUT_FOR_DELIVERY'
        ORDER BY da."startedAt" DESC, da.id LIMIT 1
      ) attempt ON true
      UNION ALL
      SELECT t.id, 'TRIP'::text, t."tripCode", t.status::text,
        CASE WHEN t.status = 'IN_TRANSIT' THEN 'TRANSIT' ELSE t.status::text END,
        t."createdAt", CASE WHEN t.status = 'PLANNED' THEN t."createdAt"
          WHEN t.status = 'READY' THEN audit.started ELSE t."departedAt" END,
        CASE WHEN t.status = 'READY' THEN 'AUDIT' ELSE 'LIFECYCLE' END,
        false, NULL::text, t."originWarehouseId", t."destinationWarehouseId", NULL::uuid,
        NULL::uuid, NULL::text, NULL::uuid, t.id, t."tripCode"
      FROM trip_scope t
      LEFT JOIN LATERAL (
        SELECT max(a."createdAt") AS started FROM "AuditLog" a
        WHERE a."entityType" = 'LineHaulTrip' AND a."entityId" = t.id::text
          AND a.after->>'status' = 'READY' AND a.before->>'status' = 'PLANNED'
      ) audit ON true
    ), validated AS (
      SELECT raw.*, CASE WHEN inconsistent OR started < "createdAt" OR started > clock."asOf"
          THEN 'INCONSISTENT' WHEN started IS NULL THEN 'MISSING' ELSE 'VALID' END AS "timestampQuality"
      FROM raw CROSS JOIN clock
    ), timed AS (
      SELECT v.*, CASE WHEN "timestampQuality" = 'VALID' THEN started END AS "stageStartedAt",
        CASE WHEN "timestampQuality" = 'VALID' THEN source END AS "timestampSource",
        CASE WHEN "timestampQuality" = 'VALID' THEN floor(extract(epoch FROM (clock."asOf" - started)))::integer END AS "agingSeconds",
        CASE WHEN "timestampQuality" = 'VALID' THEN started + b.minutes * interval '1 minute' END AS deadline,
        CASE WHEN "timestampQuality" = 'VALID' THEN started + b.minutes * (${policy.atRiskPercent}::double precision / 100) * interval '1 minute' END AS "atRiskAt",
        COALESCE("domainException", CASE WHEN "timestampQuality" <> 'VALID' THEN 'TIMESTAMP_' || "timestampQuality" END) AS exception
      FROM validated v CROSS JOIN clock LEFT JOIN budgets b ON b.stage = v.stage
    ), classified AS (
      SELECT timed.*, CASE WHEN deadline IS NULL THEN NULL
        WHEN clock."asOf" >= deadline THEN 'OVERDUE'
        WHEN clock."asOf" >= "atRiskAt" THEN 'AT_RISK' ELSE 'ON_TIME' END AS "slaState",
        COALESCE("agingSeconds" >= ${policy.agingAlertMinutes * 60}, false) AS "isAging"
      FROM timed CROSS JOIN clock
    ), filtered AS (
      SELECT classified.*, CASE WHEN "slaState" = 'OVERDUE' THEN 0 WHEN "slaState" = 'AT_RISK' THEN 1
        WHEN "isAging" THEN 2 WHEN exception IS NOT NULL THEN 3 ELSE 4 END AS priority
      FROM classified WHERE ${Prisma.join(filters, ' AND ')}
    ), page AS (
      SELECT * FROM filtered ORDER BY ${orders[query.sort]}, "entityType", id
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    ), items AS (
      SELECT p.id, p."entityType", p.code, p.status, p.stage, p."createdAt", p."stageStartedAt",
        p."timestampSource", p."timestampQuality", p."agingSeconds", p.deadline, p."atRiskAt", p."slaState",
        p."isAging", p.exception, p.priority, p."originWarehouseId", p."destinationWarehouseId", p."currentWarehouseId",
        ow.code AS "originWarehouseCode", dw.code AS "destinationWarehouseCode", cw.code AS "currentWarehouseCode",
        p."transferId", p."transferCode", p."transferWarehouseId", p."tripId", p."tripCode"
      FROM page p LEFT JOIN "Warehouse" ow ON ow.id = p."originWarehouseId"
      LEFT JOIN "Warehouse" dw ON dw.id = p."destinationWarehouseId"
      LEFT JOIN "Warehouse" cw ON cw.id = p."currentWarehouseId"
      ORDER BY ${orders[query.sort]}, p."entityType", p.id
    )
    SELECT (SELECT "asOf" FROM clock) AS "asOf", count(*)::integer AS total,
      jsonb_build_object(
        'activeShipments', count(*) FILTER (WHERE "entityType" = 'SHIPMENT'),
        'pickup', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND stage = 'PICKUP'),
        'originWarehouse', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND stage = 'ORIGIN_DWELL'),
        'inTransit', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND stage = 'TRANSIT'),
        'destinationWarehouse', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND stage = 'DESTINATION_DWELL'),
        'outForDelivery', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND stage = 'DELIVERY'),
        'exceptions', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND exception IS NOT NULL),
        'overdue', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND "slaState" = 'OVERDUE'),
        'atRisk', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND "slaState" = 'AT_RISK'),
        'aging', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND "isAging"),
        'unavailableSla', count(*) FILTER (WHERE "entityType" = 'SHIPMENT' AND "slaState" IS NULL),
        'activeTrips', count(*) FILTER (WHERE "entityType" = 'TRIP'),
        'overdueTrips', count(*) FILTER (WHERE "entityType" = 'TRIP' AND "slaState" = 'OVERDUE')
      ) AS summary,
      COALESCE((SELECT jsonb_agg(to_jsonb(items)) FROM items), '[]'::jsonb) AS items
    FROM filtered
  `;
}
