CREATE INDEX "Shipment_createdAt_idx"
ON "Shipment"("createdAt");

CREATE INDEX "DriverAssignment_driverId_type_assignedAt_idx"
ON "DriverAssignment"("driverId", "type", "assignedAt");
