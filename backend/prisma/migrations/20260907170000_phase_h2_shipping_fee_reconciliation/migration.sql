-- PostgreSQL requires new enum values to commit before CHECK constraints use them.
BEGIN;
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'REMITTED';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'SETTLED';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'DISPUTED';
COMMIT;

ALTER TABLE "ShippingFeeTransaction"
  ADD COLUMN "remittedAmount" INTEGER,
  ADD COLUMN "remittedByDriverId" UUID,
  ADD COLUMN "settledById" UUID,
  ADD COLUMN "remittedAt" TIMESTAMPTZ(3),
  ADD COLUMN "settledAt" TIMESTAMPTZ(3);

ALTER TABLE "ShippingFeeTransaction"
  DROP CONSTRAINT "ShippingFeeTransaction_state_check";

ALTER TABLE "ShippingFeeTransaction"
  ADD CONSTRAINT "ShippingFeeTransaction_remittedAmount_check" CHECK (
    "remittedAmount" IS NULL OR "remittedAmount" >= 0
  ),
  ADD CONSTRAINT "ShippingFeeTransaction_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "remittedAmount" IS NULL
      AND "remittedByDriverId" IS NULL
      AND "remittedAt" IS NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'COLLECTED'
      AND "collectedAmount" = "expectedAmount"
      AND "collectedByDriverId" IS NOT NULL
      AND "collectedAt" IS NOT NULL
      AND "remittedAmount" IS NULL
      AND "remittedByDriverId" IS NULL
      AND "remittedAt" IS NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'REMITTED'
      AND "collectedAmount" = "expectedAmount"
      AND "collectedByDriverId" IS NOT NULL
      AND "collectedAt" IS NOT NULL
      AND "remittedAmount" = "expectedAmount"
      AND "remittedByDriverId" IS NOT NULL
      AND "remittedAt" IS NOT NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'SETTLED'
      AND "collectedAmount" = "expectedAmount"
      AND "collectedByDriverId" IS NOT NULL
      AND "collectedAt" IS NOT NULL
      AND "remittedAmount" = "expectedAmount"
      AND "remittedByDriverId" IS NOT NULL
      AND "remittedAt" IS NOT NULL
      AND "settledById" IS NOT NULL
      AND "settledAt" IS NOT NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'DISPUTED'
      AND "collectedAmount" = "expectedAmount"
      AND "collectedByDriverId" IS NOT NULL
      AND "collectedAt" IS NOT NULL
      AND (
        (
          "remittedAmount" IS NULL
          AND "remittedByDriverId" IS NULL
          AND "remittedAt" IS NULL
        )
        OR (
          "remittedAmount" = "expectedAmount"
          AND "remittedByDriverId" IS NOT NULL
          AND "remittedAt" IS NOT NULL
        )
      )
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "remittedAmount" IS NULL
      AND "remittedByDriverId" IS NULL
      AND "remittedAt" IS NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "cancelledAt" IS NOT NULL
    )
  );

ALTER TABLE "ShippingFeeTransaction"
  ADD CONSTRAINT "ShippingFeeTransaction_remittedByDriverId_fkey"
    FOREIGN KEY ("remittedByDriverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShippingFeeTransaction_settledById_fkey"
    FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ShippingFeeTransaction_remittedByDriverId_status_idx"
  ON "ShippingFeeTransaction"("remittedByDriverId", "status");

CREATE TABLE "ShippingFeeDispute" (
  "id" UUID NOT NULL,
  "shippingFeeTransactionId" UUID NOT NULL,
  "fromStatus" "ShippingFeeTransactionStatus" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "openedById" UUID NOT NULL,
  "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolutionNote" VARCHAR(500),

  CONSTRAINT "ShippingFeeDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShippingFeeDispute_fromStatus_check" CHECK ("fromStatus" IN ('COLLECTED', 'REMITTED')),
  CONSTRAINT "ShippingFeeDispute_reason_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "ShippingFeeDispute_resolution_check" CHECK (
    ("resolvedAt" IS NULL AND "resolvedById" IS NULL AND "resolutionNote" IS NULL)
    OR
    ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND length(btrim("resolutionNote")) > 0)
  ),
  CONSTRAINT "ShippingFeeDispute_shippingFeeTransactionId_fkey"
    FOREIGN KEY ("shippingFeeTransactionId") REFERENCES "ShippingFeeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShippingFeeDispute_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShippingFeeDispute_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ShippingFeeDispute_shippingFeeTransactionId_openedAt_idx"
  ON "ShippingFeeDispute"("shippingFeeTransactionId", "openedAt");

CREATE UNIQUE INDEX "ShippingFeeDispute_one_active_per_transaction_key"
  ON "ShippingFeeDispute"("shippingFeeTransactionId")
  WHERE "resolvedAt" IS NULL;
