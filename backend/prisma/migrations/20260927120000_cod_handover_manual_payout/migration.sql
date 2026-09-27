-- Additive only: historical REMITTED/SETTLED records are never fabricated as confirmed handovers.
CREATE TYPE "CODRemittanceStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
CREATE TYPE "CODPayoutStatus" AS ENUM ('PENDING', 'SENT', 'PAID_OUT', 'DISPUTED');
CREATE TYPE "CODPayoutMethod" AS ENUM ('BANK_TRANSFER', 'CASH');
ALTER TABLE "CODTransaction" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CODRemittance" (
  "id" UUID NOT NULL PRIMARY KEY,
  "codTransactionId" UUID NOT NULL REFERENCES "CODTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "clientRequestId" UUID NOT NULL,
  "submittedByDriverId" UUID NOT NULL REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "CODRemittanceStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedByAdminId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMPTZ(3),
  "rejectionReason" VARCHAR(500),
  "note" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CODRemittance_review_check" CHECK (
    ("status" = 'PENDING' AND "reviewedByAdminId" IS NULL AND "reviewedAt" IS NULL AND "rejectionReason" IS NULL)
    OR ("status" = 'CONFIRMED' AND "reviewedByAdminId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NULL)
    OR ("status" = 'REJECTED' AND "reviewedByAdminId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length(trim("rejectionReason")) > 0 AND "rejectionReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "CODRemittance_codTransactionId_clientRequestId_key" ON "CODRemittance"("codTransactionId", "clientRequestId");
CREATE UNIQUE INDEX "CODRemittance_one_pending" ON "CODRemittance"("codTransactionId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "CODRemittance_one_confirmed" ON "CODRemittance"("codTransactionId") WHERE "status" = 'CONFIRMED';
CREATE INDEX "CODRemittance_status_submittedAt_idx" ON "CODRemittance"("status", "submittedAt");

CREATE TABLE "CODPayout" (
  "id" UUID NOT NULL PRIMARY KEY,
  "codTransactionId" UUID NOT NULL REFERENCES "CODTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "method" "CODPayoutMethod" NOT NULL,
  "reference" VARCHAR(200),
  "note" VARCHAR(500),
  "status" "CODPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "createdByAdminId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sentByAdminId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sentAt" TIMESTAMPTZ(3),
  "customerConfirmedAt" TIMESTAMPTZ(3),
  "disputedAt" TIMESTAMPTZ(3),
  "disputeReason" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CODPayout_bank_reference_check" CHECK ("method" <> 'BANK_TRANSFER' OR ("reference" IS NOT NULL AND length(trim("reference")) > 0)),
  CONSTRAINT "CODPayout_evidence_check" CHECK (
    ("status" = 'PENDING' AND "sentAt" IS NULL AND "sentByAdminId" IS NULL AND "customerConfirmedAt" IS NULL AND "disputedAt" IS NULL AND "disputeReason" IS NULL)
    OR ("status" <> 'PENDING' AND "sentAt" IS NOT NULL AND "sentByAdminId" IS NOT NULL AND "reference" IS NOT NULL AND length(trim("reference")) > 0 AND (
      ("status" = 'SENT' AND "customerConfirmedAt" IS NULL AND "disputedAt" IS NULL AND "disputeReason" IS NULL)
      OR ("status" = 'PAID_OUT' AND "customerConfirmedAt" IS NOT NULL AND "disputedAt" IS NULL AND "disputeReason" IS NULL)
      OR ("status" = 'DISPUTED' AND "customerConfirmedAt" IS NULL AND "disputedAt" IS NOT NULL AND "disputeReason" IS NOT NULL AND length(trim("disputeReason")) > 0)
    ))
  )
);
CREATE UNIQUE INDEX "CODPayout_codTransactionId_key" ON "CODPayout"("codTransactionId");
CREATE INDEX "CODPayout_customerId_status_idx" ON "CODPayout"("customerId", "status");
