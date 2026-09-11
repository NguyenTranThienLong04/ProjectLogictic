CREATE TYPE "CODTransactionStatus" AS ENUM ('PENDING', 'COLLECTED', 'REMITTED', 'SETTLED', 'DISPUTED');

CREATE TABLE "CODTransaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shipmentId" UUID NOT NULL,
  "expectedAmount" INTEGER NOT NULL,
  "collectedAmount" INTEGER,
  "remittedAmount" INTEGER,
  "status" "CODTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "collectedByDriverId" UUID,
  "collectedAt" TIMESTAMPTZ(3),
  "remittedAt" TIMESTAMPTZ(3),
  "settledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CODTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CODTransaction_shipmentId_key" UNIQUE ("shipmentId"),
  CONSTRAINT "CODTransaction_expectedAmount_check" CHECK ("expectedAmount" > 0),
  CONSTRAINT "CODTransaction_collectedAmount_check" CHECK ("collectedAmount" IS NULL OR "collectedAmount" >= 0),
  CONSTRAINT "CODTransaction_remittedAmount_check" CHECK ("remittedAmount" IS NULL OR "remittedAmount" >= 0),
  CONSTRAINT "CODTransaction_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CODTransaction_collectedByDriverId_fkey" FOREIGN KEY ("collectedByDriverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CODTransaction_status_createdAt_idx" ON "CODTransaction"("status", "createdAt");
CREATE INDEX "CODTransaction_collectedByDriverId_status_idx" ON "CODTransaction"("collectedByDriverId", "status");
