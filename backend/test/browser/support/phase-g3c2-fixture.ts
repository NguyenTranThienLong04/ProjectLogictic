import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulVehicleStatus,
  PrismaClient,
  UserRole,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseG3C2FixtureValue {
  actors: { dispatcher: PhaseFActor };
  assignedDriverCode: string;
  assignedVehicleCode: string;
  blockingTripCode: string;
  targetTripCode: string;
  targetTripId: string;
  cleanup: () => Promise<void>;
}

export async function createPhaseG3C2Fixture(): Promise<PhaseG3C2FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseG3C2@Browser123';
  const dispatcherActor: PhaseFActor = {
    email: `dispatcher-phase-g3c2-${runId}@example.com`,
    fullName: `Phase G3C2 Dispatcher ${suffix}`,
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
  const [dispatcher, driverUser] = await Promise.all([
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
        email: `driver-phase-g3c2-${runId}@example.com`,
        fullName: `Tài xế G3C2 ${suffix}`,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
  ]);
  const [origin, destination] = await Promise.all([
    prisma.warehouse.create({
      data: {
        code: `BG3C2-O-${suffix}`,
        name: `Browser G3C2 Origin ${suffix}`,
        address: '1 Nguyễn Huệ',
        city: 'Hồ Chí Minh',
      },
    }),
    prisma.warehouse.create({
      data: {
        code: `BG3C2-D-${suffix}`,
        name: `Browser G3C2 Destination ${suffix}`,
        address: '50 Tôn Đức Thắng',
        city: 'Hồ Chí Minh',
      },
    }),
  ]);
  const driver = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      operatingWarehouseId: origin.id,
      employeeCode: `BG3C2-DRV-${suffix}`,
      vehicleType: 'TRUCK',
      vehiclePlate: `BG3C2-${suffix}`,
      capabilities: [DriverCapability.LINE_HAUL],
      status: DriverStatus.AVAILABLE,
      isAvailable: true,
      isOnline: true,
    },
  });
  const vehicle = await prisma.lineHaulVehicle.create({
    data: {
      vehicleCode: `BG3C2-V-${suffix}`,
      licensePlate: `51C-${suffix}`,
      vehicleType: 'TRUCK',
      capacityWeightGrams: 5_000_000,
      status: LineHaulVehicleStatus.AVAILABLE,
    },
  });
  const [blockingTrip, targetTrip] = await Promise.all([
    prisma.lineHaulTrip.create({
      data: {
        tripCode: `LHT-BG3C2-BUSY-${suffix}`,
        clientRequestId: randomUUID(),
        originWarehouseId: origin.id,
        destinationWarehouseId: destination.id,
        driverId: driver.id,
        vehicleId: vehicle.id,
        status: LineHaulTripStatus.PLANNED,
        scheduledStartAt: new Date('2032-06-15T03:00:00.000Z'),
        scheduledEndAt: new Date('2032-06-15T05:00:00.000Z'),
        createdById: dispatcher.id,
      },
    }),
    prisma.lineHaulTrip.create({
      data: {
        tripCode: `LHT-BG3C2-TARGET-${suffix}`,
        clientRequestId: randomUUID(),
        originWarehouseId: origin.id,
        destinationWarehouseId: destination.id,
        driverId: driver.id,
        vehicleId: vehicle.id,
        status: LineHaulTripStatus.PLANNED,
        createdById: dispatcher.id,
      },
    }),
  ]);

  return {
    actors: { dispatcher: dispatcherActor },
    assignedDriverCode: driver.employeeCode,
    assignedVehicleCode: vehicle.vehicleCode,
    blockingTripCode: blockingTrip.tripCode,
    targetTripCode: targetTrip.tripCode,
    targetTripId: targetTrip.id,
    cleanup: async () => {
      const userIds = [dispatcher.id, driverUser.id];
      const tripIds = [blockingTrip.id, targetTrip.id];
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
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
