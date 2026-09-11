-- Persist the return destination selected when a return workflow is requested.
ALTER TABLE "Shipment" ADD COLUMN "returnWarehouseId" UUID;
CREATE INDEX "Shipment_returnWarehouseId_status_idx" ON "Shipment"("returnWarehouseId", "status");
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_returnWarehouseId_fkey"
  FOREIGN KEY ("returnWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
