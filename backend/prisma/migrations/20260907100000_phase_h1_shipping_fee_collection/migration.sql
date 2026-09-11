CREATE TYPE "ShippingFeeTransactionStatus" AS ENUM ('PENDING', 'COLLECTED', 'CANCELLED');

CREATE TABLE "ShippingFeeTransaction" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "payer" "ShippingFeePayer" NOT NULL,
  "expectedAmount" INTEGER NOT NULL,
  "collectedAmount" INTEGER,
  "status" "ShippingFeeTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "collectedByDriverId" UUID,
  "collectedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ShippingFeeTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShippingFeeTransaction_shipmentId_key" UNIQUE ("shipmentId"),
  CONSTRAINT "ShippingFeeTransaction_expectedAmount_check" CHECK ("expectedAmount" > 0),
  CONSTRAINT "ShippingFeeTransaction_collectedAmount_check" CHECK (
    "collectedAmount" IS NULL OR "collectedAmount" >= 0
  ),
  CONSTRAINT "ShippingFeeTransaction_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'COLLECTED'
      AND "collectedAmount" = "expectedAmount"
      AND "collectedByDriverId" IS NOT NULL
      AND "collectedAt" IS NOT NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "cancelledAt" IS NOT NULL
    )
  ),
  CONSTRAINT "ShippingFeeTransaction_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShippingFeeTransaction_collectedByDriverId_fkey"
    FOREIGN KEY ("collectedByDriverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ShippingFeeTransaction_status_createdAt_idx"
  ON "ShippingFeeTransaction"("status", "createdAt");

CREATE INDEX "ShippingFeeTransaction_collectedByDriverId_status_idx"
  ON "ShippingFeeTransaction"("collectedByDriverId", "status");

INSERT INTO "ShippingFeeTransaction" (
  "id",
  "shipmentId",
  "payer",
  "expectedAmount",
  "status",
  "cancelledAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  shipment."id",
  shipment."shippingFeePayer",
  shipment."totalFee",
  CASE
    WHEN shipment."status" = 'CANCELLED' THEN 'CANCELLED'::"ShippingFeeTransactionStatus"
    ELSE 'PENDING'::"ShippingFeeTransactionStatus"
  END,
  CASE
    WHEN shipment."status" = 'CANCELLED' THEN COALESCE(shipment."cancelledAt", shipment."updatedAt")
    ELSE NULL
  END,
  shipment."createdAt",
  shipment."updatedAt"
FROM "Shipment" shipment;
