import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulVehicleStatus,
  PrismaClient,
  ShipmentStatus,
  UserRole,
  WarehouseTransferStatus,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

type TransferKey = 'fourHundred' | 'fiveHundred' | 'overload' | 'exactRemainder' | 'raceFifty';

export interface PhaseG3C1FixtureValue {
  actors: Record<'dispatcher' | 'originStaff' | 'driver' | 'customer', PhaseFActor>;
  originWarehouseName: string;
  tripId: string;
  tripCode: string;
  transfers: Record<TransferKey, { id: string; code: string }>;
  cleanup: () => Promise<void>;
}

export async function createPhaseG3C1Fixture(): Promise<PhaseG3C1FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseG3C1@Browser123';
  const actors = {
    dispatcher: actor('Dispatcher', runId, password),
    originStaff: actor('Origin', runId, password),
    driver: actor('Driver', runId, password),
    customer: actor('Customer', runId, password),
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
  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: actors.dispatcher.email,
        fullName: actors.dispatcher.fullName,
        passwordHash,
        role: UserRole.DISPATCHER,
      },
    }),
    prisma.user.create({
      data: {
        email: actors.originStaff.email,
        fullName: actors.originStaff.fullName,
        passwordHash,
        role: UserRole.WAREHOUSE_STAFF,
      },
    }),
    prisma.user.create({
      data: {
        email: actors.driver.email,
        fullName: actors.driver.fullName,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
    prisma.user.create({
      data: {
        email: actors.customer.email,
        fullName: actors.customer.fullName,
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    }),
  ]);
  const [dispatcher, originStaff, driverUser, customer] = users;
  const [origin, destination] = await Promise.all([
    prisma.warehouse.create({
      data: {
        code: `BG3C1-O-${suffix}`,
        name: `Browser G3C1 Origin ${suffix}`,
        address: '1 Nguyễn Huệ',
        city: 'Hồ Chí Minh',
        latitude: 10.7758,
        longitude: 106.7005,
      },
    }),
    prisma.warehouse.create({
      data: {
        code: `BG3C1-D-${suffix}`,
        name: `Browser G3C1 Destination ${suffix}`,
        address: '50 Tôn Đức Thắng',
        city: 'Hồ Chí Minh',
        latitude: 10.7862,
        longitude: 106.7041,
      },
    }),
  ]);
  await prisma.warehouseStaffProfile.create({
    data: {
      userId: originStaff.id,
      warehouseId: origin.id,
      staffCode: `BG3C1-STF-${suffix}`,
    },
  });
  const driver = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      operatingWarehouseId: origin.id,
      employeeCode: `BG3C1-DRV-${suffix}`,
      vehicleType: 'TRUCK',
      vehiclePlate: `BG3C1-${suffix}`,
      capabilities: [DriverCapability.LINE_HAUL],
      status: DriverStatus.AVAILABLE,
      isAvailable: true,
      isOnline: true,
    },
  });
  const vehicle = await prisma.lineHaulVehicle.create({
    data: {
      vehicleCode: `BG3C1-V-${suffix}`,
      licensePlate: `51C-${suffix}`,
      vehicleType: 'TRUCK',
      capacityWeightGrams: 1_000_000,
      status: LineHaulVehicleStatus.AVAILABLE,
    },
  });
  const trip = await prisma.lineHaulTrip.create({
    data: {
      tripCode: `LHT-BG3C1-${suffix}`,
      clientRequestId: randomUUID(),
      originWarehouseId: origin.id,
      destinationWarehouseId: destination.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      status: LineHaulTripStatus.PLANNED,
      scheduledStartAt: new Date('2033-06-15T03:00:00.000Z'),
      scheduledEndAt: new Date('2033-06-15T05:00:00.000Z'),
      createdById: dispatcher.id,
    },
  });

  const transferInputs: Array<[TransferKey, string, number]> = [
    ['fourHundred', '400', 400_000],
    ['fiveHundred', '500', 500_000],
    ['overload', '150', 150_000],
    ['exactRemainder', '100', 100_000],
    ['raceFifty', '050', 50_000],
  ];
  const transferEntries = await Promise.all(
    transferInputs.map(async ([key, label, weightGrams]) => {
      const shipment = await prisma.shipment.create({
        data: {
          trackingCode: `SHP-BG3C1-${label}-${suffix}`,
          clientRequestId: randomUUID(),
          customerId: customer.id,
          senderSnapshot: { fullName: 'Browser G3C1 Sender' },
          receiverSnapshot: { fullName: 'Browser G3C1 Receiver' },
          pickupSnapshot: { city: 'Hồ Chí Minh' },
          deliverySnapshot: { city: 'Hồ Chí Minh' },
          packageSnapshot: {
            description: `Kiện kiểm thử ${label} kg`,
            packageType: 'PARCEL',
            weightGrams,
            verifiedWeightGrams: weightGrams,
            lengthCm: 40,
            widthCm: 30,
            heightCm: 25,
          },
          pricingSnapshot: { totalFee: 30_000 },
          totalFee: 30_000,
          status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
          originWarehouseId: origin.id,
          destinationWarehouseId: destination.id,
          currentWarehouseId: origin.id,
        },
      });
      const transfer = await prisma.warehouseTransfer.create({
        data: {
          transferCode: `TRF-BG3C1-${label}-${suffix}`,
          shipmentId: shipment.id,
          fromWarehouseId: origin.id,
          toWarehouseId: destination.id,
          status: WarehouseTransferStatus.PENDING,
          clientRequestId: randomUUID(),
          createdById: originStaff.id,
        },
      });
      return [key, { id: transfer.id, code: transfer.transferCode }] as const;
    }),
  );
  const transfers = Object.fromEntries(transferEntries) as PhaseG3C1FixtureValue['transfers'];

  return {
    actors,
    originWarehouseName: origin.name,
    tripId: trip.id,
    tripCode: trip.tripCode,
    transfers,
    cleanup: async () => {
      const userIds = users.map(({ id }) => id);
      const shipments = await prisma.shipment.findMany({
        where: { customerId: customer.id },
        select: { id: true },
      });
      const shipmentIds = shipments.map(({ id }) => id);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: trip.id } });
      await prisma.lineHaulTrip.update({
        where: { id: trip.id },
        data: { currentRouteId: null },
      });
      await prisma.lineHaulTripRoute.deleteMany({ where: { tripId: trip.id } });
      await prisma.lineHaulTrip.delete({ where: { id: trip.id } });
      await prisma.warehouseTransfer.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.lineHaulVehicle.delete({ where: { id: vehicle.id } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.warehouse.deleteMany({ where: { id: { in: [origin.id, destination.id] } } });
      await prisma.$disconnect();
    },
  };
}

function actor(label: string, runId: string, password: string): PhaseFActor {
  return {
    email: `${label.toLowerCase()}-phase-g3c1-${runId}@example.com`,
    fullName: `Phase G3C1 ${label}`,
    password,
  };
}
