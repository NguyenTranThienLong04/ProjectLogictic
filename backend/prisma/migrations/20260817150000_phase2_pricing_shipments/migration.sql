-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'AWAITING_PICKUP_ASSIGNMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrackingVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "baseFee" INTEGER NOT NULL,
    "includedWeightGrams" INTEGER NOT NULL,
    "extraWeightFeePerKg" INTEGER NOT NULL,
    "codFeeBasisPoints" INTEGER NOT NULL,
    "distanceFee" INTEGER NOT NULL DEFAULT 0,
    "surcharge" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingConfig_phase2_distance_check" CHECK ("distanceFee" = 0),
    CONSTRAINT "PricingConfig_phase2_surcharge_check" CHECK ("surcharge" = 0),
    CONSTRAINT "PricingConfig_phase2_discount_check" CHECK ("discount" = 0),
    CONSTRAINT "PricingConfig_positive_values_check" CHECK (
      "baseFee" >= 0 AND "includedWeightGrams" > 0 AND
      "extraWeightFeePerKg" >= 0 AND "codFeeBasisPoints" >= 0
    )
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "trackingCode" VARCHAR(32) NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "senderSnapshot" JSONB NOT NULL,
    "receiverSnapshot" JSONB NOT NULL,
    "pickupSnapshot" JSONB NOT NULL,
    "deliverySnapshot" JSONB NOT NULL,
    "packageSnapshot" JSONB NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "codAmount" INTEGER NOT NULL DEFAULT 0,
    "totalFee" INTEGER NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "cancellationPreviousStatus" "ShipmentStatus",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Shipment_money_nonnegative_check" CHECK ("codAmount" >= 0 AND "totalFee" >= 0)
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "visibility" "TrackingVisibility" NOT NULL DEFAULT 'PUBLIC',
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" "UserRole" NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(100) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfig_version_key" ON "PricingConfig"("version");
CREATE INDEX "PricingConfig_isActive_createdAt_idx" ON "PricingConfig"("isActive", "createdAt");
CREATE UNIQUE INDEX "PricingConfig_one_active" ON "PricingConfig"("isActive") WHERE "isActive" = true;
CREATE UNIQUE INDEX "Shipment_trackingCode_key" ON "Shipment"("trackingCode");
CREATE UNIQUE INDEX "Shipment_customerId_clientRequestId_key" ON "Shipment"("customerId", "clientRequestId");
CREATE INDEX "Shipment_customerId_createdAt_idx" ON "Shipment"("customerId", "createdAt");
CREATE INDEX "Shipment_status_createdAt_idx" ON "Shipment"("status", "createdAt");
CREATE INDEX "TrackingEvent_shipmentId_createdAt_idx" ON "TrackingEvent"("shipmentId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "PricingConfig" ADD CONSTRAINT "PricingConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the versioned Phase 2 pricing policy approved in docs/DOMAIN.md.
INSERT INTO "PricingConfig" (
  "id", "version", "baseFee", "includedWeightGrams", "extraWeightFeePerKg",
  "codFeeBasisPoints", "distanceFee", "surcharge", "discount", "isActive"
) VALUES (
  gen_random_uuid(), 1, 30000, 1000, 5000, 50, 0, 0, 0, true
);
