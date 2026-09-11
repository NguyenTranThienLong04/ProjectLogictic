-- Unlock Phase 4 warehouse lifecycle statuses
ALTER TYPE "ShipmentStatus" ADD VALUE 'AT_ORIGIN_WAREHOUSE';
ALTER TYPE "ShipmentStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "ShipmentStatus" ADD VALUE 'AT_DESTINATION_WAREHOUSE';
ALTER TYPE "ShipmentStatus" ADD VALUE 'AWAITING_DELIVERY_ASSIGNMENT';

-- CreateEnum
CREATE TYPE "WarehouseTransferStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Shipment"
ADD COLUMN "originWarehouseId" UUID,
ADD COLUMN "destinationWarehouseId" UUID,
ADD COLUMN "currentWarehouseId" UUID;

-- AlterTable
ALTER TABLE "TrackingEvent"
ADD COLUMN "warehouseId" UUID;

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "ward" VARCHAR(100),
    "district" VARCHAR(100),
    "city" VARCHAR(100) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStaffProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "staffCode" VARCHAR(32) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WarehouseStaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseTransfer" (
    "id" UUID NOT NULL,
    "transferCode" VARCHAR(32) NOT NULL,
    "shipmentId" UUID NOT NULL,
    "fromWarehouseId" UUID NOT NULL,
    "toWarehouseId" UUID NOT NULL,
    "status" "WarehouseTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "note" VARCHAR(500),
    "clientRequestId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "dispatchedById" UUID,
    "dispatchedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WarehouseTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WarehouseTransfer_different_warehouses_check" CHECK ("fromWarehouseId" <> "toWarehouseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE INDEX "Warehouse_city_isActive_idx" ON "Warehouse"("city", "isActive");
CREATE INDEX "Warehouse_isActive_idx" ON "Warehouse"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStaffProfile_userId_key" ON "WarehouseStaffProfile"("userId");
CREATE UNIQUE INDEX "WarehouseStaffProfile_staffCode_key" ON "WarehouseStaffProfile"("staffCode");
CREATE INDEX "WarehouseStaffProfile_warehouseId_isActive_idx" ON "WarehouseStaffProfile"("warehouseId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTransfer_transferCode_key" ON "WarehouseTransfer"("transferCode");
CREATE INDEX "WarehouseTransfer_shipmentId_status_idx" ON "WarehouseTransfer"("shipmentId", "status");
CREATE INDEX "WarehouseTransfer_fromWarehouseId_status_idx" ON "WarehouseTransfer"("fromWarehouseId", "status");
CREATE INDEX "WarehouseTransfer_toWarehouseId_status_idx" ON "WarehouseTransfer"("toWarehouseId", "status");
CREATE UNIQUE INDEX "WarehouseTransfer_createdById_clientRequestId_key" ON "WarehouseTransfer"("createdById", "clientRequestId");

-- CreateIndex
CREATE INDEX "Shipment_currentWarehouseId_status_idx" ON "Shipment"("currentWarehouseId", "status");
CREATE INDEX "Shipment_originWarehouseId_idx" ON "Shipment"("originWarehouseId");
CREATE INDEX "Shipment_destinationWarehouseId_idx" ON "Shipment"("destinationWarehouseId");

-- CreateIndex
CREATE INDEX "TrackingEvent_warehouseId_idx" ON "TrackingEvent"("warehouseId");

-- AddForeignKey
ALTER TABLE "WarehouseStaffProfile" ADD CONSTRAINT "WarehouseStaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStaffProfile" ADD CONSTRAINT "WarehouseStaffProfile_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_currentWarehouseId_fkey" FOREIGN KEY ("currentWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
