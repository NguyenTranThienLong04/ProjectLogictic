-- Phase G3C1: immutable READY capacity snapshots for historical integrity.
-- Vehicle capacity already exists as a nullable positive integer. Legacy NULL values are not
-- guessed or backfilled; those vehicles remain ineligible until an Admin sets a real capacity.
ALTER TABLE "LineHaulTrip"
ADD COLUMN "preparedManifestWeightGrams" INTEGER,
ADD COLUMN "preparedVehicleCapacityWeightGrams" INTEGER;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_prepared_capacity_snapshot_check"
CHECK (
  (
    "preparedManifestWeightGrams" IS NULL
    AND "preparedVehicleCapacityWeightGrams" IS NULL
  )
  OR
  (
    "preparedManifestWeightGrams" > 0
    AND "preparedVehicleCapacityWeightGrams" > 0
    AND "preparedManifestWeightGrams" <= "preparedVehicleCapacityWeightGrams"
  )
);
