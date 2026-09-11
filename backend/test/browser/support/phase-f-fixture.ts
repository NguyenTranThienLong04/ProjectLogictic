import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  DriverStatus,
  PrismaClient,
  ShippingFeePayer,
  UserRole,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import { requiredEnvironment } from './environment.js';

export const phaseFPassword = 'PhaseF@Browser123';

export type PhaseFActorName =
  | 'admin'
  | 'customer'
  | 'dispatcher'
  | 'originStaff'
  | 'destinationStaff'
  | 'pickupNear'
  | 'pickupFar'
  | 'pickupWrongArea'
  | 'pickupNoGps'
  | 'pickupStaleGps'
  | 'deliveryNear'
  | 'deliveryFar'
  | 'deliveryNoGps'
  | 'deliveryStaleGps';

export interface PhaseFActor {
  email: string;
  fullName: string;
  password: string;
}

export interface PhaseFOutcome {
  status: string;
  shippingFeePayer: ShippingFeePayer;
  proofCount: number;
  attemptCount: number;
  transferCount: number;
  deliveredTrackingCount: number;
  cod: {
    expectedAmount: number;
    collectedAmount: number | null;
    status: string;
  } | null;
}

export class PhaseFFixture {
  readonly actors: Record<PhaseFActorName, PhaseFActor>;
  readonly warehouseIds: { origin: string; destination: string; wrongArea: string };
  readonly warehouseNames: { origin: string; destination: string; wrongArea: string };
  readonly driverIds: Record<
    | 'pickupNear'
    | 'pickupFar'
    | 'pickupWrongArea'
    | 'pickupNoGps'
    | 'pickupStaleGps'
    | 'deliveryNear'
    | 'deliveryFar'
    | 'deliveryNoGps'
    | 'deliveryStaleGps',
    string
  >;
  readonly pickupAddressLabel = 'Kho gửi Phase F';

  private readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly userIds: string[];
  private readonly createdWarehouseIds: string[];
  private customerId: string;

  private constructor(input: {
    actors: Record<PhaseFActorName, PhaseFActor>;
    warehouseIds: PhaseFFixture['warehouseIds'];
    warehouseNames: PhaseFFixture['warehouseNames'];
    driverIds: PhaseFFixture['driverIds'];
    prisma: PrismaClient;
    redis: Redis;
    userIds: string[];
    customerId: string;
  }) {
    this.actors = input.actors;
    this.warehouseIds = input.warehouseIds;
    this.warehouseNames = input.warehouseNames;
    this.driverIds = input.driverIds;
    this.prisma = input.prisma;
    this.redis = input.redis;
    this.userIds = input.userIds;
    this.customerId = input.customerId;
    this.createdWarehouseIds = Object.values(input.warehouseIds);
  }

  static async create(): Promise<PhaseFFixture> {
    const runId = randomUUID().replaceAll('-', '');
    const suffix = runId.slice(0, 8).toUpperCase();
    const actorNames: Record<PhaseFActorName, string> = {
      admin: 'Phase F Admin',
      customer: 'Phase F Customer',
      dispatcher: 'Phase F Dispatcher',
      originStaff: 'Phase F Origin Staff',
      destinationStaff: 'Phase F Destination Staff',
      pickupNear: 'Phase F Pickup Near',
      pickupFar: 'Phase F Pickup Far',
      pickupWrongArea: 'Phase F Pickup Wrong Area',
      pickupNoGps: 'Phase F Pickup No GPS',
      pickupStaleGps: 'Phase F Pickup Stale GPS',
      deliveryNear: 'Phase F Delivery Near',
      deliveryFar: 'Phase F Delivery Far',
      deliveryNoGps: 'Phase F Delivery No GPS',
      deliveryStaleGps: 'Phase F Delivery Stale GPS',
    };
    const actors = Object.fromEntries(
      Object.entries(actorNames).map(([name, fullName]) => [
        name,
        {
          email: `${name.toLowerCase()}-phase-f-${runId}@example.com`,
          fullName,
          password: phaseFPassword,
        },
      ]),
    ) as Record<PhaseFActorName, PhaseFActor>;

    const adapter = new PrismaPg({
      connectionString: requiredEnvironment('DATABASE_URL'),
      connectionTimeoutMillis: 15_000,
      max: 1,
    });
    const prisma = new PrismaClient({ adapter });
    await prisma.$connect();
    const redis = new Redis(requiredEnvironment('REDIS_URL'), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });

    try {
      await redis.connect();
      await redis.ping();
      await PhaseFFixture.cleanupOrphans(prisma, redis);
      const passwordHash = await new PasswordHasherService().hash(phaseFPassword);
      const roleFor = (name: PhaseFActorName): UserRole => {
        if (name === 'admin') return UserRole.ADMIN;
        if (name === 'customer') return UserRole.CUSTOMER;
        if (name === 'dispatcher') return UserRole.DISPATCHER;
        if (name === 'originStaff' || name === 'destinationStaff') {
          return UserRole.WAREHOUSE_STAFF;
        }
        return UserRole.DRIVER;
      };
      await prisma.user.createMany({
        data: (Object.entries(actors) as Array<[PhaseFActorName, PhaseFActor]>).map(
          ([name, actor]) => ({
            email: actor.email,
            fullName: actor.fullName,
            passwordHash,
            role: roleFor(name),
          }),
        ),
      });
      const users = await prisma.user.findMany({
        where: { email: { in: Object.values(actors).map(({ email }) => email) } },
        select: { id: true, email: true },
      });
      const userByEmail = new Map(users.map((user) => [user.email, user.id]));
      const userId = (name: PhaseFActorName): string => {
        const id = userByEmail.get(actors[name].email);
        if (!id) throw new Error(`Phase F user was not created: ${name}`);
        return id;
      };
      const activePricing = await prisma.pricingConfig.findFirst({
        where: { isActive: true },
      });
      if (!activePricing) {
        const latestPricing = await prisma.pricingConfig.findFirst({
          orderBy: { version: 'desc' },
        });
        await prisma.pricingConfig.create({
          data: {
            version: (latestPricing?.version ?? 0) + 1,
            baseFee: 30_000,
            includedWeightGrams: 1_000,
            extraWeightFeePerKg: 5_000,
            codFeeBasisPoints: 50,
            createdById: userId('admin'),
          },
        });
      }

      const warehouseNames = {
        origin: `Phase F Sài Gòn Origin ${suffix}`,
        destination: `Phase F Sài Gòn Destination ${suffix}`,
        wrongArea: `Phase F Đà Nẵng ${suffix}`,
      };
      const warehouseCodes = {
        origin: `F-ORI-${suffix}`,
        destination: `F-DST-${suffix}`,
        wrongArea: `F-WRG-${suffix}`,
      };
      await prisma.warehouse.createMany({
        data: [
          {
            code: warehouseCodes.origin,
            name: warehouseNames.origin,
            address: '1 Nguyễn Huệ',
            ward: 'Bến Nghé',
            district: 'Quận 1',
            city: 'Hồ Chí Minh',
            latitude: 10.7758,
            longitude: 106.7005,
          },
          {
            code: warehouseCodes.destination,
            name: warehouseNames.destination,
            address: '50 Tôn Đức Thắng',
            ward: 'Bến Nghé',
            district: 'Quận 1',
            city: 'Hồ Chí Minh',
            latitude: 10.7862,
            longitude: 106.7041,
          },
          {
            code: warehouseCodes.wrongArea,
            name: warehouseNames.wrongArea,
            address: '1 Bạch Đằng',
            ward: 'Hải Châu 1',
            district: 'Hải Châu',
            city: 'Đà Nẵng',
            latitude: 16.0678,
            longitude: 108.2208,
          },
        ],
      });
      const warehouses = await prisma.warehouse.findMany({
        where: { code: { in: Object.values(warehouseCodes) } },
        select: { id: true, code: true },
      });
      const warehouseIdFor = (code: string): string => {
        const id = warehouses.find((warehouse) => warehouse.code === code)?.id;
        if (!id) throw new Error(`Phase F warehouse was not created: ${code}`);
        return id;
      };
      const warehouseIds = {
        origin: warehouseIdFor(warehouseCodes.origin),
        destination: warehouseIdFor(warehouseCodes.destination),
        wrongArea: warehouseIdFor(warehouseCodes.wrongArea),
      };

      await prisma.warehouseStaffProfile.createMany({
        data: [
          {
            userId: userId('originStaff'),
            warehouseId: warehouseIds.origin,
            staffCode: `F-ORI-STF-${suffix}`,
          },
          {
            userId: userId('destinationStaff'),
            warehouseId: warehouseIds.destination,
            staffCode: `F-DST-STF-${suffix}`,
          },
        ],
      });

      const pickupDrivers = ['pickupNear', 'pickupFar', 'pickupNoGps', 'pickupStaleGps'] as const;
      const deliveryDrivers = [
        'deliveryNear',
        'deliveryFar',
        'deliveryNoGps',
        'deliveryStaleGps',
      ] as const;
      const driverNames = [...pickupDrivers, 'pickupWrongArea' as const, ...deliveryDrivers];
      await prisma.driverProfile.createMany({
        data: driverNames.map((name, index) => ({
          userId: userId(name),
          operatingWarehouseId:
            name === 'pickupWrongArea'
              ? warehouseIds.wrongArea
              : pickupDrivers.includes(name as (typeof pickupDrivers)[number])
                ? warehouseIds.origin
                : warehouseIds.destination,
          employeeCode: `F-DRV-${index + 1}-${suffix}`,
          vehicleType: 'MOTORBIKE',
          vehiclePlate: `F${suffix.slice(0, 3)}-${index + 1}`,
          status: DriverStatus.AVAILABLE,
          isOnline: true,
          isAvailable: true,
        })),
      });
      const profiles = await prisma.driverProfile.findMany({
        where: { userId: { in: driverNames.map((name) => userId(name)) } },
        include: { user: { select: { email: true } } },
      });
      const profileByEmail = new Map(profiles.map((profile) => [profile.user.email, profile.id]));
      const driverIdFor = (name: (typeof driverNames)[number]): string => {
        const id = profileByEmail.get(actors[name].email);
        if (!id) throw new Error(`Phase F driver profile was not created: ${name}`);
        return id;
      };
      const driverIds = Object.fromEntries(
        driverNames.map((name) => [name, driverIdFor(name)]),
      ) as PhaseFFixture['driverIds'];

      await prisma.customerAddress.create({
        data: {
          customerId: userId('customer'),
          label: 'Kho gửi Phase F',
          contactName: 'Người gửi Phase F',
          phone: '0901234567',
          streetAddress: '12 Lê Thánh Tôn',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
          latitude: 10.7757,
          longitude: 106.7004,
          isDefault: true,
        },
      });

      return new PhaseFFixture({
        actors,
        warehouseIds,
        warehouseNames,
        driverIds,
        prisma,
        redis,
        userIds: users.map(({ id }) => id),
        customerId: userId('customer'),
      });
    } catch (error) {
      redis.disconnect();
      await prisma.$disconnect();
      throw error;
    }
  }

  private static async cleanupOrphans(prisma: PrismaClient, redis: Redis): Promise<void> {
    const users = await prisma.user.findMany({
      where: { email: { contains: '-phase-f-' } },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const [shipments, drivers, warehouses] = await Promise.all([
      prisma.shipment.findMany({
        where: { customerId: { in: userIds } },
        select: { id: true, trackingCode: true },
      }),
      prisma.driverProfile.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      }),
      prisma.warehouse.findMany({
        where: {
          OR: [
            { code: { startsWith: 'F-ORI-' } },
            { code: { startsWith: 'F-DST-' } },
            { code: { startsWith: 'F-WRG-' } },
          ],
        },
        select: { id: true },
      }),
    ]);
    const shipmentIds = shipments.map(({ id }) => id);
    const redisKeys = [
      ...drivers.map(({ id }) => `driver:location:${id}`),
      ...shipments.flatMap(({ id, trackingCode }) => [
        `shipment:${id}:summary`,
        `tracking:${trackingCode}`,
      ]),
    ];
    if (redisKeys.length > 0) await redis.del(...redisKeys);
    if (userIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    }
    if (shipmentIds.length > 0) {
      await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.warehouseTransfer.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    if (userIds.length > 0) {
      await prisma.customerAddress.deleteMany({ where: { customerId: { in: userIds } } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.pricingConfig.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    const warehouseIds = warehouses.map(({ id }) => id);
    if (warehouseIds.length > 0) {
      await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    }
  }

  async outcome(shipmentId: string): Promise<PhaseFOutcome> {
    const [shipment, proofCount, attemptCount, transferCount, deliveredTrackingCount] =
      await Promise.all([
        this.prisma.shipment.findUniqueOrThrow({
          where: { id: shipmentId },
          include: { codTransaction: true },
        }),
        this.prisma.shipmentProof.count({ where: { shipmentId } }),
        this.prisma.deliveryAttempt.count({ where: { shipmentId } }),
        this.prisma.warehouseTransfer.count({ where: { shipmentId } }),
        this.prisma.trackingEvent.count({ where: { shipmentId, status: 'DELIVERED' } }),
      ]);
    return {
      status: shipment.status,
      shippingFeePayer: shipment.shippingFeePayer,
      proofCount,
      attemptCount,
      transferCount,
      deliveredTrackingCount,
      cod: shipment.codTransaction
        ? {
            expectedAmount: shipment.codTransaction.expectedAmount,
            collectedAmount: shipment.codTransaction.collectedAmount,
            status: shipment.codTransaction.status,
          }
        : null,
    };
  }

  async cleanup(): Promise<void> {
    const shipments = await this.prisma.shipment.findMany({
      where: { customerId: this.customerId },
      select: { id: true, trackingCode: true },
    });
    const shipmentIds = shipments.map(({ id }) => id);
    const redisKeys = [
      ...Object.values(this.driverIds).map((id) => `driver:location:${id}`),
      ...shipments.flatMap(({ id, trackingCode }) => [
        `shipment:${id}:summary`,
        `tracking:${trackingCode}`,
      ]),
    ];
    if (redisKeys.length > 0) await this.redis.del(...redisKeys);

    await this.prisma.notification.deleteMany({ where: { userId: { in: this.userIds } } });
    if (shipmentIds.length > 0) {
      await this.prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await this.prisma.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await this.prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await this.prisma.cODTransaction.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await this.prisma.warehouseTransfer.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await this.prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await this.prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await this.prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
    await this.prisma.customerAddress.deleteMany({ where: { customerId: this.customerId } });
    await this.prisma.warehouseStaffProfile.deleteMany({
      where: { userId: { in: this.userIds } },
    });
    await this.prisma.driverProfile.deleteMany({ where: { userId: { in: this.userIds } } });
    await this.prisma.authSession.deleteMany({ where: { userId: { in: this.userIds } } });
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: { in: this.userIds } } });
    await this.prisma.auditLog.deleteMany({ where: { actorId: { in: this.userIds } } });
    await this.prisma.pricingConfig.deleteMany({ where: { createdById: { in: this.userIds } } });
    await this.prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
    await this.prisma.warehouse.deleteMany({ where: { id: { in: this.createdWarehouseIds } } });
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
