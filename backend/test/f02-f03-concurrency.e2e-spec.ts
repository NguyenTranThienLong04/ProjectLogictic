import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  Prisma,
  ShipmentStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';
import { DriversService } from '../src/modules/drivers/drivers.service.js';
import { LineHaulTripsService } from '../src/modules/line-haul/line-haul-trips.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { WarehousesService } from '../src/modules/warehouses/warehouses.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(30_000);

type Lane = 'A' | 'B';
type QueryEvent = { model: string; operation: string; result: unknown };
type Outcome = { ok: true } | { ok: false; code: string };

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof error.getResponse === 'function'
  ) {
    const getResponse = error.getResponse as () => unknown;
    const response = getResponse.call(error);
    if (response && typeof response === 'object' && 'code' in response)
      return String(response.code);
  }
  throw error;
}

describe('F02/F03 PostgreSQL command interleavings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let warehouses: WarehousesService;
  let drivers: DriversService;
  let users: UsersService;
  let trips: LineHaulTripsService;
  let actor: AuthenticatedUser;
  let customerId: string;
  let originId: string;
  let destinationB: string;
  let destinationC: string;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const lane = new AsyncLocalStorage<Lane>();
  const pids = new Map<Lane, number>();
  let afterQuery: ((event: QueryEvent) => Promise<void>) | undefined;
  const userIds: string[] = [];
  const shipmentIds: string[] = [];
  const tripIds: string[] = [];
  const vehicleIds: string[] = [];

  // Transparent instrumentation: every delegate call and transaction still runs on PostgreSQL.
  // The only injected behavior is a barrier after a selected real read, never a fake result.
  function observe<T extends object>(client: T): T {
    return new Proxy(client, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key);
        if (key === '$transaction' && typeof member === 'function') {
          return (callback: unknown, options?: unknown): unknown => {
            if (typeof callback !== 'function')
              return Reflect.apply(member, target, [callback, options]);
            return Reflect.apply(member, target, [
              async (tx: Prisma.TransactionClient) => {
                const currentLane = lane.getStore();
                if (currentLane) {
                  const [row] = await tx.$queryRaw<
                    Array<{ pid: number }>
                  >`SELECT pg_backend_pid() AS pid`;
                  pids.set(currentLane, row.pid);
                }
                const command = callback as (client: Prisma.TransactionClient) => Promise<unknown>;
                return command(observe(tx));
              },
              options,
            ]);
          };
        }
        if (
          typeof key === 'string' &&
          !key.startsWith('$') &&
          member &&
          typeof member === 'object'
        ) {
          return new Proxy(member, {
            get(delegate, operation) {
              const method: unknown = Reflect.get(delegate, operation);
              if (typeof method !== 'function') return method;
              return async (...args: unknown[]): Promise<unknown> => {
                const result: unknown = await Reflect.apply(method, delegate, args);
                if (lane.getStore() === 'A')
                  await afterQuery?.({ model: key, operation: String(operation), result });
                return result;
              };
            },
          });
        }
        const bound: unknown = typeof member === 'function' ? member.bind(target) : member;
        return bound;
      },
    });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    const allowedDatabase =
      /^\/p0_regression_\d+$/.test(url.pathname) ||
      (process.env.CI === 'true' && url.pathname === '/i1_e2e');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55432' ||
      !allowedDatabase
    ) {
      throw new Error(
        'Requires an existing isolated localhost PostgreSQL test database on port 55432',
      );
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useFactory({
        factory: (config: ConfigService) => {
          prisma = new PrismaService(config);
          return observe(prisma);
        },
        inject: [ConfigService],
      })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        getClient: () => ({
          status: 'ready',
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          mget: jest.fn(),
          quit: jest.fn(),
        }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();
    warehouses = app.get(WarehousesService);
    drivers = app.get(DriversService);
    users = app.get(UsersService);
    trips = app.get(LineHaulTripsService);
    const admin = await createUser(UserRole.ADMIN);
    actor = {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      mustChangePassword: false,
    };
    customerId = (await createUser(UserRole.CUSTOMER)).id;
    const locations = await Promise.all(
      ['O', 'B', 'C'].map((suffix) =>
        prisma.warehouse.create({
          data: {
            code: `F23-${runId}-${suffix}`,
            name: `F23 ${suffix}`,
            address: 'Test warehouse',
            city: 'Test city',
          },
        }),
      ),
    );
    [originId, destinationB, destinationC] = locations.map((item) => item.id);
  });

  afterAll(async () => {
    if (prisma && actor) {
      await prisma.lineHaulTripTransfer.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.lineHaulTrip.deleteMany({ where: { id: { in: tripIds } } });
      await prisma.lineHaulVehicle.deleteMany({ where: { id: { in: vehicleIds } } });
      await prisma.warehouseTransfer.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.warehouse.deleteMany({
        where: { id: { in: [originId, destinationB, destinationC] } },
      });
    }
    await app?.close();
  });

  async function createUser(role: UserRole) {
    const user = await prisma.user.create({
      data: {
        email: `f23-${randomUUID()}@example.test`,
        fullName: 'F23 concurrency fixture',
        passwordHash: 'test-only-no-login',
        role,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createShipment() {
    const shipment = await prisma.shipment.create({
      data: {
        trackingCode: `F23-${randomUUID().slice(0, 16)}`,
        clientRequestId: randomUUID(),
        customerId,
        senderSnapshot: {},
        receiverSnapshot: {},
        pickupSnapshot: {},
        deliverySnapshot: {},
        packageSnapshot: { weightGrams: 1000 },
        pricingSnapshot: { totalFee: 35000 },
        totalFee: 35000,
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId: originId,
        currentWarehouseId: originId,
        destinationWarehouseId: destinationB,
      },
    });
    shipmentIds.push(shipment.id);
    return shipment;
  }

  async function createPlannedTrip() {
    const driverUser = await createUser(UserRole.DRIVER);
    const driver = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        operatingWarehouseId: originId,
        employeeCode: `F23-${randomUUID().slice(0, 16)}`,
        vehicleType: 'TRUCK',
        vehiclePlate: 'F23-TEST',
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
        capabilities: [DriverCapability.PICKUP, DriverCapability.LINE_HAUL],
      },
    });
    const vehicle = await prisma.lineHaulVehicle.create({
      data: {
        vehicleCode: `F23-${randomUUID().slice(0, 16)}`,
        licensePlate: `F23-${randomUUID().slice(0, 12)}`,
        vehicleType: 'TRUCK',
        capacityWeightGrams: 10000,
      },
    });
    vehicleIds.push(vehicle.id);
    const shipment = await createShipment();
    const transfer = await warehouses.createTransfer(
      originId,
      {
        shipmentId: shipment.id,
        toWarehouseId: destinationB,
        clientRequestId: randomUUID(),
      },
      actor,
      {},
    );
    const trip = await prisma.lineHaulTrip.create({
      data: {
        tripCode: `F23-${randomUUID().slice(0, 16)}`,
        clientRequestId: randomUUID(),
        createdById: actor.id,
        originWarehouseId: originId,
        destinationWarehouseId: destinationB,
        driverId: driver.id,
        vehicleId: vehicle.id,
        scheduledStartAt: new Date('2026-10-08T01:00:00Z'),
        scheduledEndAt: new Date('2026-10-08T03:00:00Z'),
        transferAssignments: {
          create: { warehouseTransferId: transfer.id, assignedById: actor.id },
        },
      },
    });
    tripIds.push(trip.id);
    return { driver, driverUser, trip };
  }

  async function interleave(
    pausedRead: (event: QueryEvent) => boolean,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    const reached = barrier();
    const resume = barrier();
    let armed = true;
    pids.clear();
    afterQuery = async (event) => {
      if (!armed || !pausedRead(event)) return;
      armed = false;
      reached.release();
      await resume.promise;
    };
    const run = (name: Lane, command: () => Promise<unknown>): Promise<Outcome> =>
      lane.run(name, command).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, code: errorCode(error) }),
      );
    const firstResult = run('A', first);
    let secondResult: Promise<Outcome> | undefined;
    let progress = '';
    try {
      await Promise.race([
        reached.promise,
        firstResult.then(() => {
          throw new Error('Command A finished before the barrier');
        }),
      ]);
      let secondFinished = false;
      secondResult = run('B', second).finally(() => {
        secondFinished = true;
      });
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (secondFinished) {
          progress = 'B_FINISHED_WHILE_A_PAUSED';
          break;
        }
        const firstPid = pids.get('A');
        const secondPid = pids.get('B');
        if (firstPid && secondPid) {
          const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT ${firstPid}::int = ANY(pg_blocking_pids(${secondPid}::int)) AS blocked
          `;
          if (row.blocked) {
            progress = 'POSTGRES_B_BLOCKED_BY_A';
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!progress)
        throw new Error('Command B neither finished nor reached an observed PostgreSQL lock wait');
    } finally {
      resume.release();
      await Promise.all([firstResult, secondResult]);
      afterQuery = undefined;
    }
    return { progress, outcomes: [await firstResult, await secondResult] };
  }

  it.each(['create-first', 'route-first'])(
    'F02 preserves destination/active-transfer consistency: %s',
    async (order) => {
      const shipment = await createShipment();
      const create = () =>
        warehouses.createTransfer(
          originId,
          {
            shipmentId: shipment.id,
            toWarehouseId: destinationB,
            clientRequestId: randomUUID(),
          },
          actor,
          {},
        );
      const route = () =>
        warehouses.routeDestination(
          originId,
          shipment.id,
          { destinationWarehouseId: destinationC },
          actor,
          {},
        );
      const event =
        order === 'create-first'
          ? (read: QueryEvent) => read.model === 'shipment' && read.operation === 'findUnique'
          : (read: QueryEvent) =>
              read.model === 'warehouseTransfer' && read.operation === 'findFirst';
      const result = await interleave(
        event,
        order === 'create-first' ? create : route,
        order === 'create-first' ? route : create,
      );
      const current = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      const transfers = await prisma.warehouseTransfer.findMany({
        where: {
          shipmentId: shipment.id,
          status: { in: [WarehouseTransferStatus.PENDING, WarehouseTransferStatus.IN_TRANSIT] },
        },
      });
      const consistent = transfers.every(
        (transfer) => transfer.toWarehouseId === current.destinationWarehouseId,
      );
      console.info(
        'F02_INTERLEAVING',
        JSON.stringify({
          order,
          ...result,
          destinationIsC: current.destinationWarehouseId === destinationC,
          activeTransferToB: transfers.some((item) => item.toWarehouseId === destinationB),
          invariantHolds: consistent,
        }),
      );
      expect(consistent).toBe(true);
      expect(result.outcomes.filter((item) => item.ok)).toHaveLength(1);
      expect(result.outcomes.find((item) => !item.ok)).toMatchObject({
        code: order === 'create-first' ? 'ACTIVE_TRANSFER_EXISTS' : 'TRANSFER_DESTINATION_MISMATCH',
      });
      expect(
        await prisma.auditLog.count({
          where: {
            actorId: actor.id,
            OR: [
              { action: 'SHIPMENT_DESTINATION_ROUTED', entityId: shipment.id },
              {
                action: 'WAREHOUSE_TRANSFER_CREATED',
                entityId: { in: transfers.map((item) => item.id) },
              },
            ],
          },
        }),
      ).toBe(1);
    },
  );

  it.each([
    ['profile-suspend', 'eligibility-first'],
    ['profile-suspend', 'prepare-first'],
    ['account-suspend', 'eligibility-first'],
    ['account-suspend', 'prepare-first'],
    ['remove-capability', 'eligibility-first'],
    ['remove-capability', 'prepare-first'],
  ])('F03 keeps READY driver eligible: %s / %s', async (kind, order) => {
    const { driver, driverUser, trip } = await createPlannedTrip();
    const prepare = () => trips.prepare(actor, trip.id, {});
    const mutate = () =>
      kind === 'profile-suspend'
        ? drivers.update(actor, driver.id, { suspended: true }, {})
        : kind === 'account-suspend'
          ? users.setStatus(actor, driverUser.id, UserStatus.SUSPENDED, {})
          : drivers.setCapabilities(
              actor,
              driver.id,
              { capabilities: [DriverCapability.PICKUP] },
              {},
            );
    const paused =
      order === 'eligibility-first'
        ? (event: QueryEvent) =>
            event.model === 'lineHaulTrip' && event.operation === 'count' && event.result === 0
        : (event: QueryEvent) =>
            event.model === 'lineHaulTrip' && event.operation === 'findUniqueOrThrow';
    const result = await interleave(
      paused,
      order === 'eligibility-first' ? mutate : prepare,
      order === 'eligibility-first' ? prepare : mutate,
    );
    const current = await prisma.lineHaulTrip.findUniqueOrThrow({
      where: { id: trip.id },
      include: { driver: { include: { user: true } } },
    });
    const eligible =
      current.driver.status !== DriverStatus.SUSPENDED &&
      current.driver.user.status === UserStatus.ACTIVE &&
      current.driver.capabilities.includes(DriverCapability.LINE_HAUL);
    console.info(
      'F03_INTERLEAVING',
      JSON.stringify({
        kind,
        order,
        ...result,
        tripStatus: current.status,
        driverStatus: current.driver.status,
        userStatus: current.driver.user.status,
        hasLineHaul: current.driver.capabilities.includes(DriverCapability.LINE_HAUL),
        invariantHolds: current.status !== LineHaulTripStatus.READY || eligible,
      }),
    );
    expect(current.status !== LineHaulTripStatus.READY || eligible).toBe(true);
    expect(result.outcomes.filter((item) => item.ok)).toHaveLength(1);
    const expectedCode =
      order === 'eligibility-first'
        ? kind === 'remove-capability'
          ? 'LINE_HAUL_CAPABILITY_REQUIRED'
          : 'LINE_HAUL_DRIVER_INACTIVE'
        : kind === 'remove-capability'
          ? 'DRIVER_CAPABILITY_IN_USE'
          : 'DRIVER_HAS_ACTIVE_LINE_HAUL_TRIP';
    expect(result.outcomes.find((item) => !item.ok)).toMatchObject({ code: expectedCode });
    expect(
      await prisma.auditLog.count({
        where: { actorId: actor.id, entityId: { in: [trip.id, driver.id, driverUser.id] } },
      }),
    ).toBe(1);
  });
});
