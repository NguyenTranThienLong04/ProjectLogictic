-- Unlock Phase 5 last-mile and return lifecycle statuses.
ALTER TYPE "ShipmentStatus" ADD VALUE 'DELIVERY_ASSIGNED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "ShipmentStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'DELIVERY_FAILED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'RETURN_IN_TRANSIT';
ALTER TYPE "ShipmentStatus" ADD VALUE 'RETURNED';

CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');
CREATE TYPE "DeliveryFailureReason" AS ENUM (
  'RECIPIENT_UNAVAILABLE', 'RECIPIENT_REJECTED', 'WRONG_ADDRESS', 'INVALID_PHONE',
  'ADDRESS_NOT_FOUND', 'VEHICLE_ISSUE', 'WEATHER', 'OTHER'
);

CREATE TABLE "DeliveryAttempt" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "driverAssignmentId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'OUT_FOR_DELIVERY',
  "failureReason" "DeliveryFailureReason",
  "failureNote" VARCHAR(500),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShipmentProof" ADD CONSTRAINT "ShipmentProof_deliveryAttemptId_fkey"
  FOREIGN KEY ("deliveryAttemptId") REFERENCES "DeliveryAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_driverAssignmentId_fkey"
  FOREIGN KEY ("driverAssignmentId") REFERENCES "DriverAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DeliveryAttempt_shipmentId_attemptNumber_key" ON "DeliveryAttempt"("shipmentId", "attemptNumber");
CREATE INDEX "DeliveryAttempt_driverId_status_idx" ON "DeliveryAttempt"("driverId", "status");
CREATE INDEX "DeliveryAttempt_shipmentId_startedAt_idx" ON "DeliveryAttempt"("shipmentId", "startedAt");

-- Phase 3 already created ShipmentProof_type_reference_check and the stricter
-- ShipmentProof_delivery_receiver_check. Phase 5 only adds the now-valid
-- DeliveryAttempt foreign key; re-adding the existing CHECK breaks fresh replay.
