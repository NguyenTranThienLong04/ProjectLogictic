-- Phase G2: enforce timestamps for executable line-haul trip states.
ALTER TABLE "LineHaulTrip"
ADD CONSTRAINT "LineHaulTrip_departed_timestamp_check"
CHECK ("status" NOT IN ('IN_TRANSIT', 'ARRIVED') OR "departedAt" IS NOT NULL),
ADD CONSTRAINT "LineHaulTrip_arrived_timestamp_check"
CHECK ("status" <> 'ARRIVED' OR "arrivedAt" IS NOT NULL),
ADD CONSTRAINT "LineHaulTrip_timestamp_order_check"
CHECK ("arrivedAt" IS NULL OR "departedAt" IS NULL OR "arrivedAt" >= "departedAt");
