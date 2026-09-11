-- PostgreSQL requires new enum values to commit before CHECK constraints use them.
BEGIN;
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'PAYMENT_PENDING';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'PAID';
COMMIT;

CREATE TYPE "ShippingFeePaymentStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ShippingFeePaymentEventType" AS ENUM ('SUCCEEDED', 'FAILED');

ALTER TABLE "ShippingFeeTransaction"
  ADD COLUMN "paidAmount" INTEGER,
  ADD COLUMN "paidAt" TIMESTAMPTZ(3);

ALTER TABLE "ShippingFeeTransaction"
  DROP CONSTRAINT "ShippingFeeTransaction_state_check";

ALTER TABLE "ShippingFeeTransaction"
  ADD CONSTRAINT "ShippingFeeTransaction_paidAmount_check" CHECK (
    "paidAmount" IS NULL OR "paidAmount" > 0
  ),
  ADD CONSTRAINT "ShippingFeeTransaction_state_check" CHECK (
    (
      "status" IN ('PENDING', 'PAYMENT_PENDING')
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "remittedAmount" IS NULL
      AND "remittedByDriverId" IS NULL
      AND "remittedAt" IS NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'PAID'
      AND "collectedAmount" IS NULL
      AND "collectedByDriverId" IS NULL
      AND "collectedAt" IS NULL
      AND "remittedAmount" IS NULL
      AND "remittedByDriverId" IS NULL
      AND "remittedAt" IS NULL
      AND "settledById" IS NULL
      AND "settledAt" IS NULL
      AND "paidAmount" = "expectedAmount"
      AND "paidAt" IS NOT NULL
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
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
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
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
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
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
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
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
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
      AND "paidAmount" IS NULL
      AND "paidAt" IS NULL
      AND "cancelledAt" IS NOT NULL
    )
  );

CREATE TABLE "ShippingFeePayment" (
  "id" UUID NOT NULL,
  "shippingFeeTransactionId" UUID NOT NULL,
  "clientRequestId" UUID NOT NULL,
  "reference" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "providerReference" VARCHAR(100),
  "payer" "ShippingFeePayer" NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" "ShippingFeePaymentStatus" NOT NULL DEFAULT 'CREATING',
  "initiatedById" UUID NOT NULL,
  "initiatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerAcceptedAt" TIMESTAMPTZ(3),
  "succeededAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ShippingFeePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShippingFeePayment_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "ShippingFeePayment_state_check" CHECK (
    (
      "status" = 'CREATING'
      AND "providerReference" IS NULL
      AND "providerAcceptedAt" IS NULL
      AND "succeededAt" IS NULL
      AND "failedAt" IS NULL
      AND "failureCode" IS NULL
    )
    OR (
      "status" = 'PENDING'
      AND "providerReference" IS NOT NULL
      AND "providerAcceptedAt" IS NOT NULL
      AND "succeededAt" IS NULL
      AND "failedAt" IS NULL
      AND "failureCode" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "providerReference" IS NOT NULL
      AND "providerAcceptedAt" IS NOT NULL
      AND "succeededAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "failureCode" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "providerReference" IS NOT NULL
      AND "providerAcceptedAt" IS NOT NULL
      AND "succeededAt" IS NULL
      AND "failedAt" IS NOT NULL
      AND "failureCode" IS NOT NULL
    )
  ),
  CONSTRAINT "ShippingFeePayment_shippingFeeTransactionId_fkey"
    FOREIGN KEY ("shippingFeeTransactionId") REFERENCES "ShippingFeeTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShippingFeePayment_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShippingFeePayment_reference_key" ON "ShippingFeePayment"("reference");
CREATE UNIQUE INDEX "ShippingFeePayment_shippingFeeTransactionId_clientRequestId_key"
  ON "ShippingFeePayment"("shippingFeeTransactionId", "clientRequestId");
CREATE UNIQUE INDEX "ShippingFeePayment_provider_providerReference_key"
  ON "ShippingFeePayment"("provider", "providerReference");
CREATE UNIQUE INDEX "ShippingFeePayment_one_active_per_fee_key"
  ON "ShippingFeePayment"("shippingFeeTransactionId")
  WHERE "status" IN ('CREATING', 'PENDING');
CREATE INDEX "ShippingFeePayment_shippingFeeTransactionId_status_idx"
  ON "ShippingFeePayment"("shippingFeeTransactionId", "status");
CREATE INDEX "ShippingFeePayment_status_createdAt_idx"
  ON "ShippingFeePayment"("status", "createdAt");

CREATE TABLE "ShippingFeePaymentEvent" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "providerEventId" VARCHAR(100) NOT NULL,
  "payloadDigest" CHAR(64) NOT NULL,
  "type" "ShippingFeePaymentEventType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ShippingFeePaymentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShippingFeePaymentEvent_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "ShippingFeePaymentEvent_payloadDigest_check" CHECK (
    "payloadDigest" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ShippingFeePaymentEvent_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ShippingFeePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShippingFeePaymentEvent_provider_providerEventId_key"
  ON "ShippingFeePaymentEvent"("provider", "providerEventId");
CREATE INDEX "ShippingFeePaymentEvent_paymentId_receivedAt_idx"
  ON "ShippingFeePaymentEvent"("paymentId", "receivedAt");
