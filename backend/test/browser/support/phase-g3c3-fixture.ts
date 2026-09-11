import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  DriverCapability,
  DriverStatus,
  LineHaulVehicleStatus,
  PrismaClient,
  ShipmentStatus,
  UserRole,
  WarehouseTransferStatus,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseG3C3FixtureValue {
  actors: { dispatcher: PhaseFActor };
  originWarehouseId: string;
  destinationWarehouseId: string;
  driverId: string;
  driverCode: string;
  vehicleId: string;
  vehicleCode: string;
  transferCodes: string[];
  cleanup: () => Promise<void>;
}

export async function createPhaseG3C3Fixture(): Promise<PhaseG3C3FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseG3C3@Browser123';
  const dispatcherActor: PhaseFActor = {
    email: `dispatcher-phase-g3c3-${runId}@example.com`,
    fullName: `Phase G3C3 Dispatcher ${suffix}`,
    password,
  };
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredEnvironment('DATABASE_URL'),
      connectionTimeoutMillis: 15_000,
      max: 1,
    }),
  });
  await prisma.$connect();

  const passwordHash = await new PasswordHasherService().hash(password);
  const [dispatcher, customer, driverUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: dispatcherActor.email,
        fullName: dispatcherActor.fullName,
        passwordHash,
        role: UserRole.DISPATCHER,
      },
    }),
    prisma.user.create({
      data: {
        email: `customer-phase-g3c3-${runId}@example.com`,
        fullName: `Phase G3C3 Customer ${suffix}`,
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    }),
    prisma.user.create({
      data: {
        email: `driver-phase-g3c3-${runId}@example.com`,
        fullName: `Tài xế đề xuất ${suffix}`,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
  ]);
  const [origin, destination] = await Promise.all([
    prisma.warehouse.create({
      data: {
        code: `BG3C3-O-${suffix}`,
        name: `Browser G3C3 Origin ${suffix}`,
        address: '1 Nguyễn Huệ',
        city: 'Hồ Chí Minh',
        latitude: '10.7769',
        longitude: '106.7009',
      },
    }),
    prisma.warehouse.create({
      data: {
        code: `BG3C3-D-${suffix}`,
        name: `Browser G3C3 Destination ${suffix}`,
        address: '50 Bạch Đằng',
        city: 'Đà Nẵng',
        latitude: '16.0544',
        longitude: '108.2022',
      },
    }),
  ]);
  const driver = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      operatingWarehouseId: origin.id,
      employeeCode: `BG3C3-DRV-${suffix}`,
      vehicleType: 'TRUCK',
      vehiclePlate: `BG3C3-${suffix}`,
      capabilities: [DriverCapability.LINE_HAUL],
      status: DriverStatus.OFFLINE,
    },
  });
  const vehicle = await prisma.lineHaulVehicle.create({
    data: {
      vehicleCode: `BG3C3-V-${suffix}`,
      licensePlate: `51C-${suffix}`,
      vehicleType: 'TRUCK',
      capacityWeightGrams: 2_000_000,
      status: LineHaulVehicleStatus.AVAILABLE,
    },
  });
  const shipmentIds: string[] = [];
  const transferIds: string[] = [];
  const transferCodes: string[] = [];
  for (const [index, weightGrams] of [1_200_000, 600_000].entries()) {
    const shipment = await prisma.shipment.create({
      data: {
        clientRequestId: randomUUID(),
        trackingCode: `SHP-BG3C3-${index + 1}-${suffix}`,
        customerId: customer.id,
        senderSnapshot: { fullName: 'Browser sender', phone: '0900000001' },
        receiverSnapshot: { fullName: 'Browser receiver', phone: '0900000002' },
        pickupSnapshot: { city: 'Hồ Chí Minh', streetAddress: '1 Nguyễn Huệ' },
        deliverySnapshot: { city: 'Đà Nẵng', streetAddress: '50 Bạch Đằng' },
        packageSnapshot: {
          description: `Planning package ${index + 1}`,
          packageType: 'PARCEL',
          weightGrams,
          verifiedWeightGrams: weightGrams,
        },
        pricingSnapshot: { totalFee: 30_000 },
        totalFee: 30_000,
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId: origin.id,
        destinationWarehouseId: destination.id,
        currentWarehouseId: origin.id,
      },
    });
    shipmentIds.push(shipment.id);
    const transfer = await prisma.warehouseTransfer.create({
      data: {
        transferCode: `TRF-BG3C3-${index + 1}-${suffix}`,
        shipmentId: shipment.id,
        fromWarehouseId: origin.id,
        toWarehouseId: destination.id,
        status: WarehouseTransferStatus.PENDING,
        clientRequestId: randomUUID(),
        createdById: dispatcher.id,
      },
    });
    transferIds.push(transfer.id);
    transferCodes.push(transfer.transferCode);
  }

  return {
    actors: { dispatcher: dispatcherActor },
    originWarehouseId: origin.id,
    destinationWarehouseId: destination.id,
    driverId: driver.id,
    driverCode: driver.employeeCode,
    vehicleId: vehicle.id,
    vehicleCode: vehicle.vehicleCode,
    transferCodes,
    cleanup: async () => {
      const userIds = [dispatcher.id, customer.id, driverUser.id];
      const trips = await prisma.lineHaulTrip.findMany({
        where: { createdById: dispatcher.id },
        select: { id: true },
      });
      const tripIds = trips.map(({ id }) => id);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      if (tripIds.length > 0) {
        await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: tripIds } } });
        await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
      }
      await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.lineHaulVehicle.delete({ where: { id: vehicle.id } });
      await prisma.driverProfile.delete({ where: { id: driver.id } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.warehouse.deleteMany({ where: { id: { in: [origin.id, destination.id] } } });
      await prisma.$disconnect();
    },
  };
}
