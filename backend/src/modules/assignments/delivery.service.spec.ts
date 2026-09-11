import { ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  CODTransactionStatus,
  DeliveryAttemptStatus,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AssignmentCandidatesService } from './assignment-candidates.service.js';
import { DeliveryService } from './delivery.service.js';
import { DriverDeliveryListView } from './dto/list-driver-deliveries.dto.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import type { DriverTaskOwnershipService } from './driver-task-ownership.service.js';
import type { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  role: UserRole.DRIVER,
  email: 'driver@example.test',
  fullName: 'Driver One',
  mustChangePassword: false,
};
const anotherDriverId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const shipmentId = '44444444-4444-4444-8444-444444444444';

function assignment(overrides: Record<string, unknown> = {}) {
  const base = {
    id: assignmentId,
    shipmentId,
    driverId: '55555555-5555-4555-8555-555555555555',
    type: DriverAssignmentType.DELIVERY,
    status: DriverAssignmentStatus.ACCEPTED,
    assignedAt: new Date(),
    acceptedAt: new Date(),
    completedAt: null,
    shipment: {
      id: shipmentId,
      trackingCode: 'SHP-DELIVERY-1',
      customerId: '66666666-6666-4666-8666-666666666666',
      status: ShipmentStatus.OUT_FOR_DELIVERY,
      version: 1,
      receiverSnapshot: { fullName: 'Receiver', phone: '0900000002' },
      deliverySnapshot: {
        contactName: 'Receiver',
        phone: '0900000002',
        streetAddress: '2 Delivery Street',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        latitude: 10.779,
        longitude: 106.701,
      },
      codAmount: 50_000,
      totalFee: 35_000,
      shippingFeePayer: ShippingFeePayer.SENDER,
      shippingFeeTransaction: {
        id: '99999999-9999-4999-8999-999999999999',
        shipmentId,
        payer: ShippingFeePayer.SENDER,
        expectedAmount: 35_000,
        collectedAmount: 35_000,
        status: ShippingFeeTransactionStatus.COLLECTED,
        collectedByDriverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        collectedAt: new Date(),
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      destinationWarehouse: {
        code: 'HCM-01',
        name: 'Kho trung tâm',
        address: '1 Warehouse Street',
        ward: 'Phường 1',
        district: 'Quận 4',
        city: 'Hồ Chí Minh',
        latitude: new Prisma.Decimal(10.755),
        longitude: new Prisma.Decimal(106.705),
      },
    },
    driver: {
      id: '55555555-5555-4555-8555-555555555555',
      userId: actor.id,
      isOnline: true,
      status: DriverStatus.BUSY,
      version: 0,
      user: { fullName: 'Driver One', status: UserStatus.ACTIVE },
    },
    deliveryAttempts: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        attemptNumber: 1,
        status: DeliveryAttemptStatus.OUT_FOR_DELIVERY,
        failureReason: null,
        proof: null,
      },
    ],
  };
  const shipmentOverrides = (overrides.shipment ?? {}) as Record<string, unknown>;
  const driverOverrides = (overrides.driver ?? {}) as Record<string, unknown>;
  const userOverrides = (driverOverrides.user ?? {}) as Record<string, unknown>;
  return {
    ...base,
    ...overrides,
    shipment: { ...base.shipment, ...shipmentOverrides },
    driver: {
      ...base.driver,
      ...driverOverrides,
      user: { ...base.driver.user, ...userOverrides },
    },
  };
}

function service(prisma: PrismaService) {
  const notifications = {
    createIdempotent: jest.fn(() => Promise.resolve()),
    publishByEventKeys: jest.fn(() => Promise.resolve()),
    publishShipmentUpdated: jest.fn(),
    publishAssignmentCreated: jest.fn(),
  } as unknown as NotificationsService;
  return new DeliveryService(
    prisma,
    new ShipmentTransitionPolicy(),
    {
      assertDeliveryEligible: jest.fn(() => Promise.resolve(1)),
    } as unknown as AssignmentCandidatesService,
    notifications,
    {
      lock: jest.fn(() => Promise.resolve()),
      assertNoActiveLineHaulTrip: jest.fn(() => Promise.resolve()),
    } as unknown as DriverTaskOwnershipService,
    {
      collectAt: jest.fn(() => Promise.resolve({})),
    } as unknown as ShippingFeesService,
  );
}

describe('DeliveryService', () => {
  it('returns only the destination warehouse task location before delivery starts', async () => {
    const pending = assignment({
      status: DriverAssignmentStatus.PENDING,
      acceptedAt: null,
      shipment: { status: ShipmentStatus.DELIVERY_ASSIGNED },
      deliveryAttempts: [],
    });
    const findFirst = jest.fn(() => Promise.resolve(pending));
    const prisma = { driverAssignment: { findFirst } } as unknown as PrismaService;

    const result = await service(prisma).getMine(actor.id, assignmentId);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: assignmentId,
          type: DriverAssignmentType.DELIVERY,
          driver: { userId: actor.id },
        },
      }),
    );
    expect(result.taskLocation).toEqual({
      kind: 'DESTINATION_WAREHOUSE',
      label: 'HCM-01 · Kho trung tâm',
      address: '1 Warehouse Street, Phường 1, Quận 4, Hồ Chí Minh',
      latitude: 10.755,
      longitude: 106.705,
    });
    expect(result.delivery).not.toHaveProperty('latitude');
    expect(result.delivery).not.toHaveProperty('longitude');
  });

  it('switches the owned task location to receiver coordinates after delivery starts', async () => {
    const prisma = {
      driverAssignment: { findFirst: jest.fn(() => Promise.resolve(assignment())) },
    } as unknown as PrismaService;

    const result = await service(prisma).getMine(actor.id, assignmentId);

    expect(result.taskLocation).toEqual({
      kind: 'RECEIVER',
      label: 'Điểm giao · Receiver',
      address: '2 Delivery Street, Bến Nghé, Quận 1, Hồ Chí Minh',
      latitude: 10.779,
      longitude: 106.701,
    });
    expect(result.delivery).not.toHaveProperty('latitude');
    expect(result.delivery).not.toHaveProperty('longitude');
  });

  it('returns an honest no-coordinate warehouse target for legacy assignments', async () => {
    const pending = assignment({
      status: DriverAssignmentStatus.PENDING,
      acceptedAt: null,
      shipment: {
        status: ShipmentStatus.DELIVERY_ASSIGNED,
        destinationWarehouse: {
          ...assignment().shipment.destinationWarehouse,
          latitude: null,
          longitude: null,
        },
      },
      deliveryAttempts: [],
    });
    const prisma = {
      driverAssignment: { findFirst: jest.fn(() => Promise.resolve(pending)) },
    } as unknown as PrismaService;

    await expect(service(prisma).getMine(actor.id, assignmentId)).resolves.toMatchObject({
      taskLocation: { latitude: null, longitude: null },
    });
  });

  it("rejects a driver's attempt to complete another driver's assignment", async () => {
    const current = assignment({
      driver: {
        id: '55555555-5555-4555-8555-555555555555',
        userId: anotherDriverId,
        isOnline: true,
        status: DriverStatus.BUSY,
        user: { fullName: 'Other driver', status: UserStatus.ACTIVE },
      },
    });
    const tx = { driverAssignment: { findUnique: jest.fn(() => Promise.resolve(current)) } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await expect(
      service(prisma).complete(actor, assignmentId, { receiverName: 'Receiver' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('keeps receiver-paid shipping fees separate from the COD collection amount', async () => {
    const current = assignment({
      shipment: {
        codAmount: 500_000,
        totalFee: 35_000,
        shippingFeePayer: ShippingFeePayer.RECEIVER,
      },
    });
    const proof = {
      id: '88888888-8888-4888-8888-888888888888',
      capturedAt: new Date(),
      receiverName: 'Receiver',
    };
    const completed = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      shipment: {
        ...current.shipment,
        status: ShipmentStatus.DELIVERED,
        version: 2,
      },
      deliveryAttempts: [
        {
          ...current.deliveryAttempts[0],
          status: DeliveryAttemptStatus.DELIVERED,
          proof,
        },
      ],
    });
    const createCodTransaction = jest.fn<
      (args: {
        data: {
          shipmentId: string;
          expectedAmount: number;
          collectedAmount: number;
          collectedByDriverId: string;
          collectedAt: Date;
          status: CODTransactionStatus;
        };
      }) => Promise<Record<string, never>>
    >(() => Promise.resolve({}));
    const tx = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(() => Promise.resolve({})),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(completed)),
      },
      shipmentProof: { create: jest.fn(() => Promise.resolve({})) },
      deliveryAttempt: { update: jest.fn(() => Promise.resolve({})) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      cODTransaction: { create: createCodTransaction },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await service(prisma).complete(actor, assignmentId, { receiverName: 'Receiver' }, {});

    const codData = createCodTransaction.mock.calls[0]?.[0].data;
    expect(codData).toMatchObject({
      shipmentId,
      expectedAmount: 500_000,
      collectedAmount: 500_000,
      status: CODTransactionStatus.COLLECTED,
    });
    expect(codData?.expectedAmount).not.toBe(535_000);
  });

  it('returns delivery success idempotently without creating a second POD', async () => {
    const existingProof = {
      id: '88888888-8888-4888-8888-888888888888',
      capturedAt: new Date(),
      receiverName: 'Receiver',
    };
    const current = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      shipment: {
        id: shipmentId,
        trackingCode: 'SHP-DELIVERY-1',
        customerId: '66666666-6666-4666-8666-666666666666',
        status: ShipmentStatus.DELIVERED,
        version: 2,
      },
      deliveryAttempts: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          attemptNumber: 1,
          status: DeliveryAttemptStatus.DELIVERED,
          failureReason: null,
          proof: existingProof,
        },
      ],
    });
    const tx = { driverAssignment: { findUnique: jest.fn(() => Promise.resolve(current)) } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    const result = await service(prisma).complete(
      actor,
      assignmentId,
      { receiverName: 'Receiver' },
      {},
    );

    expect(result.attempt?.proof).toEqual(existingProof);
  });

  it('returns the committed start after a concurrent attempt-number race', async () => {
    const committed = assignment();
    const uniqueError = new Prisma.PrismaClientKnownRequestError('duplicate attempt number', {
      code: 'P2002',
      clientVersion: '7.9.1',
    });
    const prisma = {
      $transaction: jest.fn(() => Promise.reject(uniqueError)),
      driverAssignment: { findUnique: jest.fn(() => Promise.resolve(committed)) },
    } as unknown as PrismaService;

    const result = await service(prisma).start(actor, assignmentId, {});

    expect(result.status).toBe(DriverAssignmentStatus.ACCEPTED);
    expect(result.attempt?.attemptNumber).toBe(1);
  });

  it('returns the committed delivery after a concurrent POD unique-constraint race', async () => {
    const proof = {
      id: '88888888-8888-4888-8888-888888888888',
      capturedAt: new Date(),
      receiverName: 'Receiver',
    };
    const committed = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      shipment: { ...assignment().shipment, status: ShipmentStatus.DELIVERED, version: 2 },
      deliveryAttempts: [
        {
          ...assignment().deliveryAttempts[0],
          status: DeliveryAttemptStatus.DELIVERED,
          proof,
        },
      ],
    });
    const uniqueError = new Prisma.PrismaClientKnownRequestError('duplicate proof', {
      code: 'P2002',
      clientVersion: '7.9.1',
    });
    const prisma = {
      $transaction: jest.fn(() => Promise.reject(uniqueError)),
      driverAssignment: { findUnique: jest.fn(() => Promise.resolve(committed)) },
    } as unknown as PrismaService;

    const result = await service(prisma).complete(
      actor,
      assignmentId,
      { receiverName: 'Receiver' },
      {},
    );

    expect(result.attempt?.proof).toEqual(proof);
  });

  it('records a failed delivery on its own DeliveryAttempt rather than overwriting it', async () => {
    const current = assignment();
    const completed = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      shipment: { ...current.shipment, status: ShipmentStatus.DELIVERY_FAILED, version: 2 },
      deliveryAttempts: [
        {
          ...current.deliveryAttempts[0],
          status: DeliveryAttemptStatus.FAILED,
          failureReason: 'RECIPIENT_UNAVAILABLE',
          proof: null,
        },
      ],
    });
    const tx = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(() => Promise.resolve({})),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(completed)),
      },
      deliveryAttempt: { update: jest.fn(() => Promise.resolve({})) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
      notification: {
        createMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      notification: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;

    const result = await service(prisma).fail(
      actor,
      assignmentId,
      { reason: 'RECIPIENT_UNAVAILABLE' },
      {},
    );

    expect(tx.deliveryAttempt.update).toHaveBeenCalledTimes(1);
    expect(result.attempt?.attemptNumber).toBe(1);
  });

  it('rejects delivery completion when driver state changed concurrently', async () => {
    const current = assignment();
    const tx = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(() => Promise.resolve({})),
      },
      shipmentProof: { create: jest.fn(() => Promise.resolve({})) },
      deliveryAttempt: { update: jest.fn(() => Promise.resolve({})) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    await expect(
      service(prisma).complete(actor, assignmentId, { receiverName: 'Receiver' }, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects return start when a newer active assignment supersedes the failed attempt owner', async () => {
    const failedAt = new Date('2026-08-21T06:00:00.000Z');
    const shipment = {
      id: shipmentId,
      status: ShipmentStatus.RETURN_REQUESTED,
      version: 3,
      deliveryAttempts: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          status: DeliveryAttemptStatus.FAILED,
          completedAt: failedAt,
          driver: {
            userId: actor.id,
            status: DriverStatus.AVAILABLE,
            user: { status: UserStatus.ACTIVE },
          },
        },
      ],
    };
    const tx = {
      shipment: {
        findUnique: jest.fn(() => Promise.resolve(shipment)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      driverAssignment: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: '99999999-9999-4999-8999-999999999999',
            driverId: anotherDriverId,
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;

    let thrown: unknown;
    try {
      await service(prisma).startReturn(actor, shipmentId, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      code: 'RETURN_OWNERSHIP_SUPERSEDED',
    });
    expect(tx.driverAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        shipmentId,
        type: { in: [DriverAssignmentType.PICKUP, DriverAssignmentType.DELIVERY] },
        status: { in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED] },
        assignedAt: { gt: failedAt },
      },
    });
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('paginates driver delivery history in server-side queries', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const count = jest.fn(() => Promise.resolve(0));
    const prisma = {
      driverProfile: { findUnique: jest.fn(() => Promise.resolve({ id: anotherDriverId })) },
      driverAssignment: { findMany, count },
    } as unknown as PrismaService;

    const result = await service(prisma).listMine(actor.id, {
      view: DriverDeliveryListView.HISTORY,
      search: 'SHP-2026',
      page: 2,
      limit: 10,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, orderBy: { assignedAt: 'desc' } }),
    );
    expect(count).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ page: 2, limit: 10, total: 0, totalPages: 0 });
  });
});
