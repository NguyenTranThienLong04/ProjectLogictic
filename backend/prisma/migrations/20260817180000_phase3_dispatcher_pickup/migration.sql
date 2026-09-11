-- Unlock the Phase 3 pickup lifecycle.
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKUP_ASSIGNED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKUP_IN_PROGRESS';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKED_UP';

CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'BUSY', 'SUSPENDED');
CREATE TYPE "DriverAssignmentType" AS ENUM ('PICKUP', 'DELIVERY');
CREATE TYPE "DriverAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ShipmentProofType" AS ENUM ('PICKUP', 'DELIVERY');

ALTER TABLE "Shipment"
ADD COLUMN "confirmedAt" TIMESTAMPTZ(3),
ADD COLUMN "pickedUpAt" TIMESTAMPTZ(3);

CREATE TABLE "DriverProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" VARCHAR(32) NOT NULL,
    "vehicleType" VARCHAR(50) NOT NULL,
    "vehiclePlate" VARCHAR(20) NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DriverProfile_availability_check" CHECK (
      ("status" = 'OFFLINE' AND NOT "isOnline" AND NOT "isAvailable") OR
      ("status" = 'AVAILABLE' AND "isOnline" AND "isAvailable") OR
      ("status" = 'BUSY' AND "isOnline" AND NOT "isAvailable") OR
      ("status" = 'SUSPENDED' AND NOT "isOnline" AND NOT "isAvailable")
    )
);

CREATE TABLE "DriverAssignment" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "DriverAssignmentType" NOT NULL,
    "status" "DriverAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "clientRequestId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "reason" VARCHAR(500),
    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentProof" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "type" "ShipmentProofType" NOT NULL,
    "driverAssignmentId" UUID,
    "deliveryAttemptId" UUID,
    "fileUrl" TEXT,
    "note" VARCHAR(500),
    "receiverName" VARCHAR(100),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentProof_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShipmentProof_type_reference_check" CHECK (
      ("type" = 'PICKUP' AND "driverAssignmentId" IS NOT NULL AND "deliveryAttemptId" IS NULL) OR
      ("type" = 'DELIVERY' AND "driverAssignmentId" IS NULL AND "deliveryAttemptId" IS NOT NULL)
    ),
    CONSTRAINT "ShipmentProof_delivery_receiver_check" CHECK (
      "type" <> 'DELIVERY' OR NULLIF(BTRIM("receiverName"), '') IS NOT NULL
    )
);

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventKey" VARCHAR(150) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");
CREATE UNIQUE INDEX "DriverProfile_employeeCode_key" ON "DriverProfile"("employeeCode");
CREATE INDEX "DriverProfile_status_updatedAt_idx" ON "DriverProfile"("status", "updatedAt");

CREATE UNIQUE INDEX "DriverAssignment_assignedById_clientRequestId_key" ON "DriverAssignment"("assignedById", "clientRequestId");
CREATE INDEX "DriverAssignment_driverId_status_idx" ON "DriverAssignment"("driverId", "status");
CREATE INDEX "DriverAssignment_shipmentId_type_status_idx" ON "DriverAssignment"("shipmentId", "type", "status");
CREATE UNIQUE INDEX "DriverAssignment_one_active_pickup_per_shipment"
ON "DriverAssignment"("shipmentId") WHERE "type" = 'PICKUP' AND "status" IN ('PENDING', 'ACCEPTED');
CREATE UNIQUE INDEX "DriverAssignment_one_active_assignment_per_driver"
ON "DriverAssignment"("driverId") WHERE "status" IN ('PENDING', 'ACCEPTED');

CREATE UNIQUE INDEX "ShipmentProof_driverAssignmentId_key" ON "ShipmentProof"("driverAssignmentId");
CREATE UNIQUE INDEX "ShipmentProof_deliveryAttemptId_key" ON "ShipmentProof"("deliveryAttemptId");
CREATE INDEX "ShipmentProof_shipmentId_idx" ON "ShipmentProof"("shipmentId");

CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_shipmentId_fkey"
FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_assignedById_fkey"
FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentProof" ADD CONSTRAINT "ShipmentProof_shipmentId_fkey"
FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentProof" ADD CONSTRAINT "ShipmentProof_driverAssignmentId_fkey"
FOREIGN KEY ("driverAssignmentId") REFERENCES "DriverAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentProof" ADD CONSTRAINT "ShipmentProof_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 5 creates DeliveryAttempt and adds ShipmentProof_deliveryAttemptId_fkey.
-- The Phase 3 CHECK constraint already prevents malformed pickup/delivery reference combinations.
