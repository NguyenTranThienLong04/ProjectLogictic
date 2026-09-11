import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  ShippingFeePayer,
  ShipmentStatus,
  UserRole,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseH3FixtureValue {
  actor: PhaseFActor;
  shipmentId: string;
  trackingCode: string;
  feeAmount: number;
  codAmount: number;
  cleanup: () => Promise<void>;
}

export async function createPhaseH3Fixture(): Promise<PhaseH3FixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseH3@Browser123';
  const actor: PhaseFActor = {
    email: `h3-customer-${runId.slice(0, 16)}@example.com`,
    fullName: 'Phase H3 Browser Customer',
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
  const customer = await prisma.user.create({
    data: {
      email: actor.email,
      fullName: actor.fullName,
      phone: '0901234567',
      passwordHash: await new PasswordHasherService().hash(password),
      role: UserRole.CUSTOMER,
    },
  });
  const feeAmount = 35_000;
  const codAmount = 180_000;
  const shipment = await prisma.shipment.create({
    data: {
      trackingCode: `SHP-BH3-${suffix}`,
      clientRequestId: randomUUID(),
      customerId: customer.id,
      senderSnapshot: { fullName: actor.fullName, phone: '0901234567' },
      receiverSnapshot: { fullName: 'Người nhận Browser H3', phone: '0987654321' },
      pickupSnapshot: {
        contactName: actor.fullName,
        phone: '0901234567',
        streetAddress: '1 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
      },
      deliverySnapshot: {
        contactName: 'Người nhận Browser H3',
        phone: '0987654321',
        streetAddress: '2 Lê Lợi',
        ward: 'Bến Thành',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
      },
      packageSnapshot: {
        description: 'Kiện Browser H3',
        packageType: 'PARCEL',
        weightGrams: 1_000,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      },
      pricingSnapshot: { totalFee: feeAmount },
      codAmount,
      totalFee: feeAmount,
      shippingFeePayer: ShippingFeePayer.SENDER,
      status: ShipmentStatus.PICKUP_IN_PROGRESS,
      shippingFeeTransaction: {
        create: { payer: ShippingFeePayer.SENDER, expectedAmount: feeAmount },
      },
    },
  });

  return {
    actor,
    shipmentId: shipment.id,
    trackingCode: shipment.trackingCode,
    feeAmount,
    codAmount,
    cleanup: async () => {
      const payments = await prisma.shippingFeePayment.findMany({
        where: { shippingFeeTransaction: { shipmentId: shipment.id } },
        select: { id: true },
      });
      const paymentIds = payments.map(({ id }) => id);
      await prisma.shippingFeePaymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.shippingFeePayment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: shipment.id } });
      await prisma.auditLog.deleteMany({ where: { actorId: customer.id } });
      await prisma.authSession.deleteMany({ where: { userId: customer.id } });
      await prisma.shipment.delete({ where: { id: shipment.id } });
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.$disconnect();
    },
  };
}
