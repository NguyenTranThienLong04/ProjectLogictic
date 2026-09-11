-- Phase G3B1: immutable-at-READY line-haul route metric snapshots.
CREATE TYPE "RouteMetricMode" AS ENUM ('ROAD_ROUTE', 'HAVERSINE_FALLBACK');

ALTER TABLE "LineHaulTrip"
ADD COLUMN "plannedDistanceMeters" INTEGER,
ADD COLUMN "plannedDurationSeconds" INTEGER,
ADD COLUMN "routeMetricMode" "RouteMetricMode",
ADD COLUMN "routeProvider" VARCHAR(50),
ADD COLUMN "routeCalculatedAt" TIMESTAMPTZ(3);

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_route_metric_snapshot_check"
CHECK (
  (
    "plannedDistanceMeters" IS NULL
    AND "plannedDurationSeconds" IS NULL
    AND "routeMetricMode" IS NULL
    AND "routeProvider" IS NULL
    AND "routeCalculatedAt" IS NULL
  )
  OR
  (
    "plannedDistanceMeters" IS NOT NULL
    AND "plannedDistanceMeters" >= 0
    AND "routeMetricMode" IS NOT NULL
    AND "routeProvider" IS NOT NULL
    AND length("routeProvider") > 0
    AND "routeCalculatedAt" IS NOT NULL
    AND (
      (
        "routeMetricMode" = 'ROAD_ROUTE'
        AND "plannedDurationSeconds" IS NOT NULL
        AND "plannedDurationSeconds" >= 0
      )
      OR
      (
        "routeMetricMode" = 'HAVERSINE_FALLBACK'
        AND "plannedDurationSeconds" IS NULL
      )
    )
  )
);
