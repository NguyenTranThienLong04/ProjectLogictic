import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  LineHaulTripRouteType,
  LineHaulVehicleStatus,
  PrismaClient,
  RouteMetricMode,
  ShipmentStatus,
  UserRole,
  WarehouseTransferStatus,
} from '../../../src/generated/prisma/client.js';
import { PasswordHasherService } from '../../../src/modules/auth/password-hasher.service.js';
import type { PhaseFActor } from './phase-f-fixture.js';
import { requiredEnvironment } from './environment.js';

export interface PhaseG3AFixtureValue {
  actors: Record<'admin' | 'dispatcher' | 'driver' | 'destinationStaff' | 'customer', PhaseFActor>;
  tripId: string;
  tripCode: string;
  destinationWarehouseName: string;
  cleanup: () => Promise<void>;
}

export async function createPhaseG3AFixture(): Promise<PhaseG3AFixtureValue> {
  const runId = randomUUID().replaceAll('-', '');
  const suffix = runId.slice(0, 8).toUpperCase();
  const password = 'PhaseG3A@Browser123';
  const actors = {
    admin: actor('Admin', runId, password),
    dispatcher: actor('Dispatcher', runId, password),
    driver: actor('Driver', runId, password),
    destinationStaff: actor('Destination', runId, password),
    customer: actor('Customer', runId, password),
  };
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: requiredEnvironment('DATABASE_URL'),
      connectionTimeoutMillis: 15_000,
      max: 1,
    }),
  });
  const redis = new Redis(requiredEnvironment('REDIS_URL'), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  await prisma.$connect();
  await redis.connect();
  await redis.ping();

  const passwordHash = await new PasswordHasherService().hash(password);
  const users = await Promise.all([
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
        email: actors.dispatcher.email,
        fullName: actors.dispatcher.fullName,
        passwordHash,
        role: UserRole.DISPATCHER,
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
        email: actors.destinationStaff.email,
        fullName: actors.destinationStaff.fullName,
        passwordHash,
        role: UserRole.WAREHOUSE_STAFF,
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
  const [, dispatcher, driverUser, destinationStaff, customer] = users;
  const [origin, destination] = await Promise.all([
    prisma.warehouse.create({
      data: {
        code: `BG3A-O-${suffix}`,
        name: `Browser G3A Origin ${suffix}`,
        address: '1 Nguyễn Huệ',
        city: 'Hồ Chí Minh',
        latitude: 10.7758,
        longitude: 106.7005,
      },
    }),
    prisma.warehouse.create({
      data: {
        code: `BG3A-D-${suffix}`,
        name: `Browser G3A Destination ${suffix}`,
        address: '50 Tôn Đức Thắng',
        city: 'Hồ Chí Minh',
        latitude: 10.7862,
        longitude: 106.7041,
      },
    }),
  ]);
  await prisma.warehouseStaffProfile.create({
    data: {
      userId: destinationStaff.id,
      warehouseId: destination.id,
      staffCode: `BG3A-STF-${suffix}`,
    },
  });
  const driver = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      operatingWarehouseId: origin.id,
      employeeCode: `BG3A-DRV-${suffix}`,
      vehicleType: 'MOTORBIKE',
      vehiclePlate: `BG3A-${suffix}`,
      capabilities: [DriverCapability.LINE_HAUL],
      status: DriverStatus.BUSY,
      isOnline: true,
    },
  });
  const vehicle = await prisma.lineHaulVehicle.create({
    data: {
      vehicleCode: `BG3A-V-${suffix}`,
      licensePlate: `51C-${suffix}`,
      vehicleType: 'TRUCK',
      status: LineHaulVehicleStatus.IN_USE,
    },
  });
  const shipment = await prisma.shipment.create({
    data: {
      trackingCode: `SHP-BG3A-${suffix}`,
      clientRequestId: randomUUID(),
      customerId: customer.id,
      senderSnapshot: { fullName: 'Browser Sender' },
      receiverSnapshot: { fullName: 'Browser Receiver' },
      pickupSnapshot: { city: 'Hồ Chí Minh' },
      deliverySnapshot: { city: 'Hồ Chí Minh' },
      packageSnapshot: { description: 'Browser G3A', packageType: 'PARCEL', weightGrams: 500 },
      pricingSnapshot: { totalFee: 30_000 },
      totalFee: 30_000,
      status: ShipmentStatus.IN_TRANSIT,
      originWarehouseId: origin.id,
      destinationWarehouseId: destination.id,
      currentWarehouseId: null,
      pickedUpAt: new Date(),
    },
  });
  const departedAt = new Date();
  const transfer = await prisma.warehouseTransfer.create({
    data: {
      transferCode: `TRF-BG3A-${suffix}`,
      shipmentId: shipment.id,
      fromWarehouseId: origin.id,
      toWarehouseId: destination.id,
      status: WarehouseTransferStatus.IN_TRANSIT,
      clientRequestId: randomUUID(),
      createdById: dispatcher.id,
      dispatchedById: dispatcher.id,
      dispatchedAt: departedAt,
    },
  });
  const trip = await prisma.lineHaulTrip.create({
    data: {
      tripCode: `LHT-BG3A-${suffix}`,
      clientRequestId: randomUUID(),
      originWarehouseId: origin.id,
      destinationWarehouseId: destination.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      status: LineHaulTripStatus.IN_TRANSIT,
      departedAt,
      plannedDistanceMeters: 2_400,
      plannedDurationSeconds: 360,
      routeMetricMode: RouteMetricMode.ROAD_ROUTE,
      routeProvider: 'OSRM_TEST',
      routeCalculatedAt: departedAt,
      createdById: dispatcher.id,
    },
  });
  const plannedRoute = await prisma.lineHaulTripRoute.create({
    data: {
      tripId: trip.id,
      version: 1,
      type: LineHaulTripRouteType.PLANNED,
      startLatitude: Number(origin.latitude),
      startLongitude: Number(origin.longitude),
      destinationLatitude: Number(destination.latitude),
      destinationLongitude: Number(destination.longitude),
      distanceMeters: 2_400,
      durationSeconds: 360,
      metricMode: RouteMetricMode.ROAD_ROUTE,
      provider: 'OSRM_TEST',
      geometry: {
        points: [
          { latitude: Number(origin.latitude), longitude: Number(origin.longitude) },
          { latitude: 10.7757, longitude: 106.7004 },
          { latitude: 10.7762, longitude: 106.7013 },
          { latitude: 10.777, longitude: 106.702 },
          { latitude: 10.7778, longitude: 106.7028 },
          { latitude: 10.7785, longitude: 106.7036 },
          { latitude: Number(destination.latitude), longitude: Number(destination.longitude) },
        ],
      },
      calculatedAt: departedAt,
      createdById: dispatcher.id,
    },
  });
  await prisma.lineHaulTrip.update({
    where: { id: trip.id },
    data: { currentRouteId: plannedRoute.id },
  });
  await prisma.lineHaulTripTransfer.create({
    data: {
      tripId: trip.id,
      warehouseTransferId: transfer.id,
      assignedById: dispatcher.id,
    },
  });

  return {
    actors,
    tripId: trip.id,
    tripCode: trip.tripCode,
    destinationWarehouseName: destination.name,
    cleanup: async () => {
      await redis.del(
        `linehaul:trip:location:${trip.id}`,
        `linehaul:trip:deviation:${trip.id}:route:1`,
        `linehaul:trip:deviation:${trip.id}:route:2`,
      );
      const userIds = users.map(({ id }) => id);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: shipment.id } });
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: trip.id } });
      await prisma.lineHaulTrip.update({
        where: { id: trip.id },
        data: { currentRouteId: null },
      });
      await prisma.lineHaulTripRoute.deleteMany({ where: { tripId: trip.id } });
      await prisma.lineHaulTrip.delete({ where: { id: trip.id } });
      await prisma.warehouseTransfer.delete({ where: { id: transfer.id } });
      await prisma.shippingFeeTransaction.deleteMany({ where: { shipmentId: shipment.id } });
      await prisma.shipment.delete({ where: { id: shipment.id } });
      await prisma.lineHaulVehicle.delete({ where: { id: vehicle.id } });
      await prisma.warehouseStaffProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.warehouse.deleteMany({ where: { id: { in: [origin.id, destination.id] } } });
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}

function actor(label: string, runId: string, password: string): PhaseFActor {
  return {
    email: `${label.toLowerCase()}-phase-g3a-${runId}@example.com`,
    fullName: `Phase G3A ${label}`,
    password,
  };
}
