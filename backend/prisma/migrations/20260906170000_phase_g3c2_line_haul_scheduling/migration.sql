-- Phase G3C2: explicit line-haul schedule windows and race-safe resource reservations.
-- Existing trips remain valid with a NULL window; no historical duration is guessed.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "LineHaulTrip"
ADD COLUMN "scheduledStartAt" TIMESTAMPTZ(3),
ADD COLUMN "scheduledEndAt" TIMESTAMPTZ(3);

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_schedule_window_check"
CHECK (
  (
    "scheduledStartAt" IS NULL
    AND "scheduledEndAt" IS NULL
  )
  OR
  (
    "scheduledStartAt" IS NOT NULL
    AND "scheduledEndAt" IS NOT NULL
    AND "scheduledEndAt" > "scheduledStartAt"
  )
);

-- G1 treated every PLANNED trip as an exclusive resource owner. G3C2 replaces that
-- coarse lock with half-open time windows so adjacent reservations remain legal.
DROP INDEX "LineHaulTrip_active_driver_key";
DROP INDEX "LineHaulTrip_active_vehicle_key";

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_driver_schedule_excl"
EXCLUDE USING gist (
  "driverId" WITH =,
  tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&
)
WHERE (
  "scheduledStartAt" IS NOT NULL
  AND "scheduledEndAt" IS NOT NULL
  AND "status" IN ('PLANNED', 'READY', 'IN_TRANSIT')
);

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_vehicle_schedule_excl"
EXCLUDE USING gist (
  "vehicleId" WITH =,
  tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&
)
WHERE (
  "scheduledStartAt" IS NOT NULL
  AND "scheduledEndAt" IS NOT NULL
  AND "status" IN ('PLANNED', 'READY', 'IN_TRANSIT')
);

CREATE INDEX "LineHaulTrip_status_scheduledStartAt_idx"
ON "LineHaulTrip"("status", "scheduledStartAt");
