import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  DeliveryAttemptStatus,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  PrismaClient,
  ShippingFeePayer,
  ShipmentStatus,
  UserRole,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseH1FixtureValue {
  actors: Record<'admin' | 'customer' | 'pickupDriver' | 'deliveryDriver', PhaseFActor>;
  pickupAssignmentId: string;
  deliveryAssignmentId: string;
  senderShipmentId: string;
  receiverShipmentId: string;
  senderFee: number;
  receiverFee: number;
  receiverCod: number;
  cleanup: () => Promise<void>;
}

export async function createPhaseH1Fixture(): Promise<PhaseH1FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH1@Browser123';
  const actors = {
    admin: actor('Admin', runId, password),
    customer: actor('Customer', runId, password),
    pickupDriver: actor('Pickup Driver', runId, password),
    deliveryDriver: actor('Delivery Driver', runId, password),
  };
  const dispatcher = actor('Dispatcher', runId, password);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredEnvironment('DATABASE_URL'),
      connectionTimeoutMillis: 15_000,
      max: 1,
    }),
  });
  await prisma.$connect();
  const passwordHash = await new PasswordHasherService().hash(password);
  const [adminUser, customerUser, pickupUser, deliveryUser, dispatcherUser] = await Promise.all([
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
        email: actors.pickupDriver.email,
        fullName: actors.pickupDriver.fullName,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
    prisma.user.create({
      data: {
        email: actors.deliveryDriver.email,
        fullName: actors.deliveryDriver.fullName,
        passwordHash,
        role: UserRole.DRIVER,
      },
    }),
    prisma.user.create({
      data: {
        email: dispatcher.email,
        fullName: dispatcher.fullName,
        passwordHash,
        role: UserRole.DISPATCHER,
      },
    }),
  ]);
  const users = [adminUser, customerUser, pickupUser, deliveryUser, dispatcherUser];
  const warehouse = await prisma.warehouse.create({
    data: {
      code: `BH1-${suffix}`,
      name: `Kho Browser H1 ${suffix}`,
      address: '1 Nguyễn Huệ',
      ward: 'Bến Nghé',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
      latitude: 10.7769,
      longitude: 106.7009,
    },
  });
  const [pickupDriver, deliveryDriver] = await Promise.all([
    prisma.driverProfile.create({
      data: {
        userId: pickupUser.id,
        operatingWarehouseId: warehouse.id,
        employeeCode: `BH1-P-${suffix}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `BH1-P-${suffix}`,
        status: DriverStatus.BUSY,
        isOnline: true,
        isAvailable: false,
      },
    }),
    prisma.driverProfile.create({
      data: {
        userId: deliveryUser.id,
        operatingWarehouseId: warehouse.id,
        employeeCode: `BH1-D-${suffix}`,
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `BH1-D-${suffix}`,
        status: DriverStatus.BUSY,
        isOnline: true,
        isAvailable: false,
      },
    }),
  ]);
  const senderFee = 35_000;
  const receiverFee = 42_000;
  const receiverCod = 500_000;
  const senderShipment = await createShipment(prisma, {
    customerId: customerUser.id,
    suffix,
    label: 'SENDER',
    payer: ShippingFeePayer.SENDER,
    status: ShipmentStatus.PICKUP_IN_PROGRESS,
    totalFee: senderFee,
    codAmount: 0,
  });
  const pickupAssignment = await prisma.driverAssignment.create({
    data: {
      shipmentId: senderShipment.id,
      driverId: pickupDriver.id,
      type: DriverAssignmentType.PICKUP,
      status: DriverAssignmentStatus.ACCEPTED,
      clientRequestId: randomUUID(),
      assignedById: dispatcherUser.id,
      acceptedAt: new Date(),
    },
  });

  const receiverShipment = await createShipment(prisma, {
    customerId: customerUser.id,
    suffix,
    label: 'RECEIVER',
    payer: ShippingFeePayer.RECEIVER,
    status: ShipmentStatus.OUT_FOR_DELIVERY,
    totalFee: receiverFee,
    codAmount: receiverCod,
  });
  const deliveryAssignment = await prisma.driverAssignment.create({
    data: {
      shipmentId: receiverShipment.id,
      driverId: deliveryDriver.id,
      type: DriverAssignmentType.DELIVERY,
      status: DriverAssignmentStatus.ACCEPTED,
      clientRequestId: randomUUID(),
      assignedById: dispatcherUser.id,
      acceptedAt: new Date(),
    },
  });
  await prisma.deliveryAttempt.create({
    data: {
      shipmentId: receiverShipment.id,
      driverId: deliveryDriver.id,
      driverAssignmentId: deliveryAssignment.id,
      attemptNumber: 1,
      status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
    },
  });

  return {
    actors,
    pickupAssignmentId: pickupAssignment.id,
    deliveryAssignmentId: deliveryAssignment.id,
    senderShipmentId: senderShipment.id,
    receiverShipmentId: receiverShipment.id,
    senderFee,
    receiverFee,
    receiverCod,
    cleanup: async () => {
      const shipmentIds = [senderShipment.id, receiverShipment.id];
      const userIds = users.map(({ id }) => id);
      await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
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
    status: ShipmentStatus;
    totalFee: number;
    codAmount: number;
  },
) {
  return prisma.shipment.create({
    data: {
      trackingCode: `SHP-BH1-${input.label}-${input.suffix}`,
      clientRequestId: randomUUID(),
      customerId: input.customerId,
      senderSnapshot: {
        fullName: 'Người gửi Browser H1',
        phone: '0901234567',
      },
      receiverSnapshot: {
        fullName: 'Người nhận Browser H1',
        phone: '0987654321',
      },
      pickupSnapshot: {
        contactName: 'Người gửi Browser H1',
        phone: '0901234567',
        streetAddress: '1 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        latitude: 10.7769,
        longitude: 106.7009,
      },
      deliverySnapshot: {
        contactName: 'Người nhận Browser H1',
        phone: '0987654321',
        streetAddress: '2 Lê Lợi',
        ward: 'Bến Thành',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        latitude: 10.775,
        longitude: 106.699,
      },
      packageSnapshot: {
        description: `Kiện Browser H1 ${input.label}`,
        packageType: 'PARCEL',
        weightGrams: 1_000,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      },
      pricingSnapshot: {
        configVersion: 1,
        baseFee: input.totalFee,
        distanceFee: 0,
        weightFee: 0,
        codFee: 0,
        surcharge: 0,
        discount: 0,
        totalFee: input.totalFee,
      },
      codAmount: input.codAmount,
      totalFee: input.totalFee,
      shippingFeePayer: input.payer,
      status: input.status,
      shippingFeeTransaction: {
        create: { payer: input.payer, expectedAmount: input.totalFee },
      },
    },
  });
}

function actor(label: string, runId: string, password: string): PhaseFActor {
  return {
    email: `h1-${label.toLowerCase().replaceAll(' ', '-')}-${runId.slice(0, 16)}@example.com`,
    fullName: `Phase H1 Browser ${label}`,
    password,
  };
}
