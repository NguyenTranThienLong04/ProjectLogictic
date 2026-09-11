-- Phase G1: line-haul driver capability, fleet, trip planning, and transfer association history.
CREATE TYPE "DriverCapability" AS ENUM ('PICKUP', 'DELIVERY', 'LINE_HAUL');
CREATE TYPE "LineHaulVehicleStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'INACTIVE');
CREATE TYPE "LineHaulTripStatus" AS ENUM ('PLANNED', 'READY', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED');

ALTER TABLE "DriverProfile"
ADD COLUMN "capabilities" "DriverCapability"[] NOT NULL
DEFAULT ARRAY['PICKUP'::"DriverCapability", 'DELIVERY'::"DriverCapability"];

ALTER TABLE "DriverProfile"
ADD CONSTRAINT "DriverProfile_capabilities_not_empty_check"
CHECK (cardinality("capabilities") > 0);

CREATE TABLE "LineHaulVehicle" (
    "id" UUID NOT NULL,
    "vehicleCode" VARCHAR(32) NOT NULL,
    "licensePlate" VARCHAR(20) NOT NULL,
    "vehicleType" VARCHAR(50) NOT NULL,
    "capacityWeightGrams" INTEGER,
    "status" "LineHaulVehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LineHaulVehicle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineHaulVehicle_capacity_positive_check"
        CHECK ("capacityWeightGrams" IS NULL OR "capacityWeightGrams" > 0)
);

CREATE TABLE "LineHaulTrip" (
    "id" UUID NOT NULL,
    "tripCode" VARCHAR(32) NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "originWarehouseId" UUID NOT NULL,
    "destinationWarehouseId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "status" "LineHaulTripStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedDepartureAt" TIMESTAMPTZ(3),
    "departedAt" TIMESTAMPTZ(3),
    "arrivedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "createdById" UUID NOT NULL,
    "cancelledById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LineHaulTrip_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineHaulTrip_distinct_warehouses_check"
        CHECK ("originWarehouseId" <> "destinationWarehouseId"),
    CONSTRAINT "LineHaulTrip_cancelled_timestamp_check"
        CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
);

CREATE TABLE "LineHaulTripTransfer" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "warehouseTransferId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" UUID,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LineHaulTripTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineHaulTripTransfer_active_history_check" CHECK (
        ("isActive" = true AND "removedAt" IS NULL AND "removedById" IS NULL)
        OR
        ("isActive" = false AND "removedAt" IS NOT NULL AND "removedById" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "LineHaulVehicle_vehicleCode_key" ON "LineHaulVehicle"("vehicleCode");
CREATE UNIQUE INDEX "LineHaulVehicle_licensePlate_key" ON "LineHaulVehicle"("licensePlate");
CREATE INDEX "LineHaulVehicle_status_updatedAt_idx" ON "LineHaulVehicle"("status", "updatedAt");

CREATE UNIQUE INDEX "LineHaulTrip_tripCode_key" ON "LineHaulTrip"("tripCode");
CREATE UNIQUE INDEX "LineHaulTrip_createdById_clientRequestId_key" ON "LineHaulTrip"("createdById", "clientRequestId");
CREATE INDEX "LineHaulTrip_status_plannedDepartureAt_idx" ON "LineHaulTrip"("status", "plannedDepartureAt");
CREATE INDEX "LineHaulTrip_originWarehouseId_status_idx" ON "LineHaulTrip"("originWarehouseId", "status");
CREATE INDEX "LineHaulTrip_destinationWarehouseId_status_idx" ON "LineHaulTrip"("destinationWarehouseId", "status");
CREATE INDEX "LineHaulTrip_driverId_status_idx" ON "LineHaulTrip"("driverId", "status");
CREATE INDEX "LineHaulTrip_vehicleId_status_idx" ON "LineHaulTrip"("vehicleId", "status");
CREATE UNIQUE INDEX "LineHaulTrip_active_driver_key" ON "LineHaulTrip"("driverId")
WHERE "status" IN ('PLANNED', 'READY', 'IN_TRANSIT');
CREATE UNIQUE INDEX "LineHaulTrip_active_vehicle_key" ON "LineHaulTrip"("vehicleId")
WHERE "status" IN ('PLANNED', 'READY', 'IN_TRANSIT');

CREATE INDEX "LineHaulTripTransfer_tripId_isActive_idx" ON "LineHaulTripTransfer"("tripId", "isActive");
CREATE INDEX "LineHaulTripTransfer_warehouseTransferId_assignedAt_idx" ON "LineHaulTripTransfer"("warehouseTransferId", "assignedAt");
CREATE UNIQUE INDEX "LineHaulTripTransfer_active_transfer_key" ON "LineHaulTripTransfer"("warehouseTransferId")
WHERE "isActive" = true;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_originWarehouseId_fkey"
FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_destinationWarehouseId_fkey"
FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "LineHaulVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTripTransfer"
ADD CONSTRAINT "LineHaulTripTransfer_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "LineHaulTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTripTransfer"
ADD CONSTRAINT "LineHaulTripTransfer_warehouseTransferId_fkey"
FOREIGN KEY ("warehouseTransferId") REFERENCES "WarehouseTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTripTransfer"
ADD CONSTRAINT "LineHaulTripTransfer_assignedById_fkey"
FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineHaulTripTransfer"
ADD CONSTRAINT "LineHaulTripTransfer_removedById_fkey"
FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
