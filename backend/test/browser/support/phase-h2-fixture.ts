import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  CODTransactionStatus,
  DriverStatus,
  PrismaClient,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  UserRole,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseH2FixtureValue {
  actors: Record<'admin' | 'customer' | 'driver', PhaseFActor>;
  shippingFeeId: string;
  shipmentId: string;
  trackingCode: string;
  feeAmount: number;
  codAmount: number;
  driverName: string;
  driverEmployeeCode: string;
  cleanup: () => Promise<void>;
}

export async function createPhaseH2Fixture(): Promise<PhaseH2FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH2@Browser123';
  const actors = {
    admin: actor('Admin', runId, password),
    customer: actor('Customer', runId, password),
    driver: actor('Driver', runId, password),
  };
  const otherDriverActor = actor('Other Driver', runId, password);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredEnvironment('DATABASE_URL'),
      connectionTimeoutMillis: 15_000,
      max: 1,
    }),
  });
  await prisma.$connect();
  const passwordHash = await new PasswordHasherService().hash(password);
  const [adminUser, customerUser, driverUser, otherDriverUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: actors.admin.email,
        fullName: actors.admin.fullName,
        passwordHash,
        role: UserRole.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        email: actors.customer.email,
        fullName: actors.customer.fullName,
        phone: '0901234567',
        passwordHash,
        role: UserRole.CUSTOMER,
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
        email: otherDriverActor.email,
        fullName: otherDriverActor.fullName,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
  ]);
  const users = [adminUser, customerUser, driverUser, otherDriverUser];
  const warehouse = await prisma.warehouse.create({
    data: {
      code: `BH2-${suffix}`,
      name: `Kho Browser H2 ${suffix}`,
      address: '1 Nguyễn Huệ',
      city: 'Hồ Chí Minh',
    },
  });
  const driverEmployeeCode = `BH2-D-${suffix}`;
  const [driver, otherDriver] = await Promise.all([
    prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        operatingWarehouseId: warehouse.id,
        employeeCode: driverEmployeeCode,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `BH2-D-${suffix}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    }),
    prisma.driverProfile.create({
      data: {
        userId: otherDriverUser.id,
        operatingWarehouseId: warehouse.id,
        employeeCode: `BH2-O-${suffix}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `BH2-O-${suffix}`,
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    }),
  ]);
  const feeAmount = 35_000;
  const codAmount = 180_000;
  const shipment = await createShipment(prisma, {
    customerId: customerUser.id,
    suffix,
    label: 'LIFECYCLE',
    payer: ShippingFeePayer.SENDER,
    totalFee: feeAmount,
    codAmount,
  });
  const collectedAt = new Date('2026-09-07T08:00:00.000Z');
  const shippingFee = await prisma.shippingFeeTransaction.create({
    data: {
      shipmentId: shipment.id,
      payer: ShippingFeePayer.SENDER,
      expectedAmount: feeAmount,
      collectedAmount: feeAmount,
      collectedByDriverId: driver.id,
      collectedAt,
      status: ShippingFeeTransactionStatus.COLLECTED,
    },
  });
  await prisma.cODTransaction.create({
    data: {
      shipmentId: shipment.id,
      expectedAmount: codAmount,
      collectedAmount: codAmount,
      collectedByDriverId: driver.id,
      collectedAt,
      status: CODTransactionStatus.COLLECTED,
    },
  });

  const otherShipment = await createShipment(prisma, {
    customerId: customerUser.id,
    suffix,
    label: 'OTHER',
    payer: ShippingFeePayer.RECEIVER,
    totalFee: 42_000,
    codAmount: 0,
  });
  await prisma.shippingFeeTransaction.create({
    data: {
      shipmentId: otherShipment.id,
      payer: ShippingFeePayer.RECEIVER,
      expectedAmount: 42_000,
      collectedAmount: 42_000,
      collectedByDriverId: otherDriver.id,
      collectedAt,
      status: ShippingFeeTransactionStatus.COLLECTED,
    },
  });

  return {
    actors,
    shippingFeeId: shippingFee.id,
    shipmentId: shipment.id,
    trackingCode: shipment.trackingCode,
    feeAmount,
    codAmount,
    driverName: driverUser.fullName,
    driverEmployeeCode,
    cleanup: async () => {
      const shipmentIds = [shipment.id, otherShipment.id];
      const userIds = users.map(({ id }) => id);
      const feeIds = (
        await prisma.shippingFeeTransaction.findMany({
          where: { shipmentId: { in: shipmentIds } },
          select: { id: true },
        })
      ).map(({ id }) => id);
      await prisma.shippingFeeDispute.deleteMany({
        where: { shippingFeeTransactionId: { in: feeIds } },
      });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.warehouse.delete({ where: { id: warehouse.id } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    },
  };
}

async function createShipment(
  prisma: PrismaClient,
  input: {
    customerId: string;
    suffix: string;
    label: string;
    payer: ShippingFeePayer;
    totalFee: number;
    codAmount: number;
  },
) {
  return prisma.shipment.create({
    data: {
      trackingCode: `SHP-BH2-${input.label}-${input.suffix}`,
      clientRequestId: randomUUID(),
      customerId: input.customerId,
      senderSnapshot: { fullName: 'Người gửi Browser H2', contactName: 'Người gửi Browser H2' },
      receiverSnapshot: {
        fullName: 'Người nhận Browser H2',
        contactName: 'Người nhận Browser H2',
      },
      pickupSnapshot: { contactName: 'Người gửi Browser H2', city: 'Hồ Chí Minh' },
      deliverySnapshot: { contactName: 'Người nhận Browser H2', city: 'Hồ Chí Minh' },
      packageSnapshot: { description: `Kiện Browser H2 ${input.label}`, weightGrams: 1_000 },
      pricingSnapshot: { totalFee: input.totalFee },
      codAmount: input.codAmount,
      totalFee: input.totalFee,
      shippingFeePayer: input.payer,
      status: ShipmentStatus.DELIVERED,
    },
  });
}

function actor(label: string, runId: string, password: string): PhaseFActor {
  return {
    email: `h2-${label.toLowerCase().replaceAll(' ', '-')}-${runId.slice(0, 16)}@example.com`,
    fullName: `Phase H2 Browser ${label}`,
    password,
  };
}
