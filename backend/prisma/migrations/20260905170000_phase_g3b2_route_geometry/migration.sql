-- Phase G3B2: append-only line-haul route geometry/version history and one current route reference.
CREATE TYPE "LineHaulTripRouteType" AS ENUM ('PLANNED', 'REROUTE');

ALTER TABLE "LineHaulTrip"
ADD COLUMN "currentRouteId" UUID;

CREATE TABLE "LineHaulTripRoute" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "LineHaulTripRouteType" NOT NULL,
    "startLatitude" DECIMAL(9,6) NOT NULL,
    "startLongitude" DECIMAL(9,6) NOT NULL,
    "destinationLatitude" DECIMAL(9,6) NOT NULL,
    "destinationLongitude" DECIMAL(9,6) NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "metricMode" "RouteMetricMode" NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "geometry" JSONB,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineHaulTripRoute_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineHaulTripRoute_version_check" CHECK ("version" >= 1),
    CONSTRAINT "LineHaulTripRoute_coordinates_check" CHECK (
      "startLatitude" BETWEEN -90 AND 90
      AND "destinationLatitude" BETWEEN -90 AND 90
      AND "startLongitude" BETWEEN -180 AND 180
      AND "destinationLongitude" BETWEEN -180 AND 180
    ),
    CONSTRAINT "LineHaulTripRoute_metric_check" CHECK (
      "distanceMeters" >= 0
      AND length("provider") > 0
      AND (
        ("metricMode" = 'ROAD_ROUTE' AND "durationSeconds" IS NOT NULL AND "durationSeconds" >= 0)
        OR ("metricMode" = 'HAVERSINE_FALLBACK' AND "durationSeconds" IS NULL)
      )
    ),
    CONSTRAINT "LineHaulTripRoute_geometry_shape_check" CHECK (
      "geometry" IS NULL
      OR (
        jsonb_typeof("geometry") = 'object'
        AND jsonb_typeof("geometry"->'points') = 'array'
        AND jsonb_array_length("geometry"->'points') BETWEEN 2 AND 2000
      )
    )
);

CREATE UNIQUE INDEX "LineHaulTrip_currentRouteId_key" ON "LineHaulTrip"("currentRouteId");
CREATE UNIQUE INDEX "LineHaulTripRoute_tripId_version_key" ON "LineHaulTripRoute"("tripId", "version");
CREATE INDEX "LineHaulTripRoute_tripId_createdAt_idx" ON "LineHaulTripRoute"("tripId", "createdAt");
CREATE UNIQUE INDEX "LineHaulTripRoute_planned_key" ON "LineHaulTripRoute"("tripId")
WHERE "type" = 'PLANNED';

-- Preserve G3B1 snapshots as planned v1 history. Geometry stays honestly unavailable.
INSERT INTO "LineHaulTripRoute" (
  "id", "tripId", "version", "type",
  "startLatitude", "startLongitude", "destinationLatitude", "destinationLongitude",
  "distanceMeters", "durationSeconds", "metricMode", "provider", "geometry",
  "calculatedAt", "createdById", "createdAt"
)
SELECT
  md5(trip."id"::text || ':route:v1')::uuid,
  trip."id", 1, 'PLANNED',
  origin."latitude", origin."longitude", destination."latitude", destination."longitude",
  trip."plannedDistanceMeters", trip."plannedDurationSeconds", trip."routeMetricMode",
  trip."routeProvider", NULL, trip."routeCalculatedAt", NULL, trip."updatedAt"
FROM "LineHaulTrip" trip
JOIN "Warehouse" origin ON origin."id" = trip."originWarehouseId"
JOIN "Warehouse" destination ON destination."id" = trip."destinationWarehouseId"
WHERE trip."plannedDistanceMeters" IS NOT NULL
  AND trip."routeMetricMode" IS NOT NULL
  AND trip."routeProvider" IS NOT NULL
  AND trip."routeCalculatedAt" IS NOT NULL
  AND origin."latitude" IS NOT NULL
  AND origin."longitude" IS NOT NULL
  AND destination."latitude" IS NOT NULL
  AND destination."longitude" IS NOT NULL;

UPDATE "LineHaulTrip" trip
SET "currentRouteId" = route."id"
FROM "LineHaulTripRoute" route
WHERE route."tripId" = trip."id" AND route."version" = 1;

ALTER TABLE "LineHaulTripRoute"
ADD CONSTRAINT "LineHaulTripRoute_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "LineHaulTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTripRoute"
ADD CONSTRAINT "LineHaulTripRoute_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_currentRouteId_fkey"
FOREIGN KEY ("currentRouteId") REFERENCES "LineHaulTripRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
