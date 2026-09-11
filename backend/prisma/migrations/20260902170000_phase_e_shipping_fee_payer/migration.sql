-- Existing shipments predate payer selection. Backfill them to SENDER without
-- changing any monetary snapshot or COD data; new API creates still require an
-- explicit payer even though the database keeps this compatibility default.
CREATE TYPE "ShippingFeePayer" AS ENUM ('SENDER', 'RECEIVER');

ALTER TABLE "Shipment"
ADD COLUMN "shippingFeePayer" "ShippingFeePayer" NOT NULL DEFAULT 'SENDER';
