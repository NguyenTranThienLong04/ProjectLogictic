-- Phase D separates transfer creation from physical dispatch.
ALTER TABLE "WarehouseTransfer"
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- A shipment can have only one active warehouse movement at a time.
CREATE UNIQUE INDEX "WarehouseTransfer_one_active_per_shipment_key"
ON "WarehouseTransfer"("shipmentId")
WHERE "status" IN ('PENDING', 'IN_TRANSIT');
