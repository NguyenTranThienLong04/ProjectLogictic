-- Phase B keeps existing driver profiles valid while requiring an explicit
-- operating warehouse before they can become assignment candidates.
ALTER TABLE "DriverProfile"
ADD COLUMN "operatingWarehouseId" UUID;

CREATE INDEX "DriverProfile_operatingWarehouseId_status_idx"
ON "DriverProfile"("operatingWarehouseId", "status");

ALTER TABLE "DriverProfile"
ADD CONSTRAINT "DriverProfile_operatingWarehouseId_fkey"
FOREIGN KEY ("operatingWarehouseId") REFERENCES "Warehouse"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
