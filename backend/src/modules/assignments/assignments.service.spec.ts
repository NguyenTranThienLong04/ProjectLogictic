import { ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  Prisma,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentProofType,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationsGateway } from '../notifications/notifications.gateway.js';
import type { AssignmentCandidatesService } from './assignment-candidates.service.js';
import { AssignmentsService } from './assignments.service.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import type { DriverTaskOwnershipService } from './driver-task-ownership.service.js';
import type { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';

const driverUserId = 'fda6ead1-b787-4cb4-9070-0be947e5fa4b';
const assignmentId = '33138525-a382-4f4a-b9ca-a112026a0487';
const shipmentId = '86038431-9653-4fd4-af5f-e66f1dcf3aa1';
const driverId = '8772b03b-3491-48d0-b217-ccab2e18a7fb';
const customerId = '3437505b-b972-4e8a-aa82-175bbf160618';
const originWarehouseId = 'f7af647c-4d22-47ad-bf7c-46d97c129c65';
const now = new Date('2026-08-17T10:00:00.000Z');
const actor: AuthenticatedUser = {
  id: driverUserId,
  email: 'driver@example.com',
  fullName: 'Pickup Driver',
  role: UserRole.DRIVER,
  mustChangePassword: false,
};

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: assignmentId,
    shipmentId,
    driverId,
    type: DriverAssignmentType.PICKUP,
    status: DriverAssignmentStatus.ACCEPTED,
    clientRequestId: '20b046a4-1ab2-4098-93d9-10737a093b17',
    assignedById: 'a220ce56-421c-49eb-a0f6-98ec06846043',
    assignedAt: now,
    acceptedAt: now,
    rejectedAt: null,
    completedAt: null,
    cancelledAt: null,
    reason: null,
    shipment: {
      id: shipmentId,
      trackingCode: 'SHP-20260817-ABC12345',
      customerId,
      status: ShipmentStatus.PICKUP_IN_PROGRESS,
      version: 2,
      pickupSnapshot: {
        contactName: 'Sender',
        phone: '0900000000',
        streetAddress: '1 Main',
        ward: 'Ward',
        district: 'District',
        city: 'HCM',
        latitude: 10.7769,
        longitude: 106.7009,
      },
      receiverSnapshot: { fullName: 'Receiver', phone: '0911111111' },
      totalFee: 35_000,
      shippingFeePayer: ShippingFeePayer.SENDER,
      shippingFeeTransaction: {
        id: '0a475f75-f557-4fbf-9bda-58dad5518ed8',
        shipmentId,
        payer: ShippingFeePayer.SENDER,
        expectedAmount: 35_000,
        collectedAmount: null,
        status: ShippingFeeTransactionStatus.PENDING,
        collectedByDriverId: null,
        collectedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    driver: {
      id: driverId,
      userId: driverUserId,
      operatingWarehouseId: originWarehouseId,
      employeeCode: 'DRV-001',
      vehicleType: 'Motorbike',
      vehiclePlate: '59A1-12345',
      status: DriverStatus.BUSY,
      isOnline: true,
      isAvailable: false,
      version: 0,
      user: { id: driverUserId, fullName: actor.fullName, status: UserStatus.ACTIVE },
    },
    proof: null,
    ...overrides,
  };
}

function service(prisma: PrismaService): AssignmentsService {
  const gateway = {
    emitNotification: jest.fn(),
    emitAssignmentCreated: jest.fn(),
    emitShipmentUpdated: jest.fn(),
  } as unknown as NotificationsGateway;
  return new AssignmentsService(
    prisma,
    new ShipmentTransitionPolicy(),
    {
      assertPickupEligible: jest.fn(() => Promise.resolve(1)),
    } as unknown as AssignmentCandidatesService,
    new NotificationsService(
      prisma,
      gateway,
      {
        invalidateShipment: jest.fn(() => Promise.resolve()),
      } as never,
      {
        enqueueNotifications: jest.fn(() => Promise.resolve()),
      } as never,
    ),
    {
      lock: jest.fn(() => Promise.resolve()),
      assertNoActiveLineHaulTrip: jest.fn(() => Promise.resolve()),
    } as unknown as DriverTaskOwnershipService,
    {
      collectAt: jest.fn(() => Promise.resolve({})),
    } as unknown as ShippingFeesService,
  );
}

describe('AssignmentsService pickup commands', () => {
  it('does not let a driver act on another driver assignment', async () => {
    const transaction = {
      driverAssignment: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            assignment({
              driver: { ...assignment().driver, userId: '15dc97c7-a517-47cb-a355-d0c34f7db388' },
            }),
          ),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      notification: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;

    await expect(service(prisma).accept(actor, assignmentId, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects atomically, writes internal audit and notifies every active dispatcher', async () => {
    const current = assignment();
    const rejected = assignment({
      status: DriverAssignmentStatus.REJECTED,
      rejectedAt: now,
      reason: 'Vehicle issue',
      shipment: { ...current.shipment, status: ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT },
    });
    const transaction = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(rejected)),
      },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: {
        create: jest.fn<
          (args: { data: Record<string, unknown> }) => Promise<Record<string, never>>
        >(() => Promise.resolve({})),
      },
      user: {
        findMany: jest.fn(() =>
          Promise.resolve([
            { id: '3a301081-8031-4410-a6cc-ae824168ab63' },
            { id: '82a33ce8-4eb4-44d2-aa8d-781136655010' },
          ]),
        ),
      },
      notification: {
        createMany: jest.fn<
          (args: { data: Array<{ userId: string }> }) => Promise<{ count: number }>
        >(() => Promise.resolve({ count: 2 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      notification: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;

    const result = await service(prisma).reject(
      actor,
      assignmentId,
      { reason: ' Vehicle issue ' },
      {},
    );

    expect(result.status).toBe(DriverAssignmentStatus.REJECTED);
    const auditCall = transaction.auditLog.create.mock.calls[0]?.[0] as unknown as {
      data: { action: string };
    };
    const notificationCall = transaction.notification.createMany.mock.calls[0]?.[0];
    expect(auditCall.data.action).toBe('PICKUP_ASSIGNMENT_REJECT');
    expect(notificationCall.data.map(({ userId }) => userId)).toContain(
      '3a301081-8031-4410-a6cc-ae824168ab63',
    );
  });

  it('rolls back a pickup rejection when driver availability changed concurrently', async () => {
    const current = assignment();
    const transaction = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      service(prisma).reject(actor, assignmentId, { reason: 'Vehicle issue' }, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.trackingEvent.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('derives proof createdById from the authenticated assigned driver', async () => {
    const current = assignment();
    const proof = {
      id: '0dc32144-dc9d-41ea-9167-03146303131d',
      shipmentId,
      type: ShipmentProofType.PICKUP,
      driverAssignmentId: assignmentId,
      deliveryAttemptId: null,
      fileUrl: null,
      note: 'Package sealed',
      receiverName: null,
      latitude: null,
      longitude: null,
      capturedAt: now,
      createdById: driverUserId,
      createdAt: now,
    };
    const completed = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      completedAt: now,
      proof,
      shipment: { ...current.shipment, status: ShipmentStatus.PICKED_UP },
    });
    const transaction = {
      driverAssignment: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(completed)),
      },
      shipmentProof: {
        create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<typeof proof>>(() =>
          Promise.resolve(proof),
        ),
      },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      driverProfile: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
      notification: {
        createMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      notification: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;

    await service(prisma).pickup(actor, assignmentId, { note: ' Package sealed ' }, {});

    const proofCall = transaction.shipmentProof.create.mock.calls[0]?.[0] as unknown as {
      data: {
        shipmentId: string;
        driverAssignmentId: string;
        createdById: string;
        type: ShipmentProofType;
      };
    };
    expect(proofCall.data).toMatchObject({
      shipmentId,
      driverAssignmentId: assignmentId,
      createdById: driverUserId,
      type: ShipmentProofType.PICKUP,
    });
    const shipmentUpdateCalls = transaction.shipment.updateMany.mock.calls as unknown as Array<
      [{ data: { status: ShipmentStatus; originWarehouseId: string } }]
    >;
    const shipmentUpdateCall = shipmentUpdateCalls[0]?.[0];
    expect(shipmentUpdateCall).toBeDefined();
    if (!shipmentUpdateCall) throw new Error('Expected shipment update call');
    expect(shipmentUpdateCall.data).toMatchObject({
      status: ShipmentStatus.PICKED_UP,
      originWarehouseId,
    });
  });

  it('returns the existing proof as success after a unique-constraint race', async () => {
    const proof = {
      id: '0dc32144-dc9d-41ea-9167-03146303131d',
      shipmentId,
      type: ShipmentProofType.PICKUP,
      driverAssignmentId: assignmentId,
      deliveryAttemptId: null,
      fileUrl: null,
      note: null,
      receiverName: null,
      latitude: null,
      longitude: null,
      capturedAt: now,
      createdById: driverUserId,
      createdAt: now,
    };
    const existing = assignment({
      status: DriverAssignmentStatus.COMPLETED,
      completedAt: now,
      proof,
      shipment: { ...assignment().shipment, status: ShipmentStatus.PICKED_UP },
    });
    const uniqueError = new Prisma.PrismaClientKnownRequestError('duplicate proof', {
      code: 'P2002',
      clientVersion: '7.9.1',
    });
    const prisma = {
      $transaction: jest.fn(() => Promise.reject(uniqueError)),
      driverAssignment: { findUnique: jest.fn(() => Promise.resolve(existing)) },
      notification: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;

    const result = await service(prisma).pickup(actor, assignmentId, {}, {});

    expect(result.proof?.id).toBe(proof.id);
  });

  it('loads pickup detail through an ownership-scoped query', async () => {
    const findFirst = jest.fn(() => Promise.resolve(assignment()));
    const prisma = { driverAssignment: { findFirst } } as unknown as PrismaService;

    const result = await service(prisma).getMine(actor.id, assignmentId);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: assignmentId,
          type: DriverAssignmentType.PICKUP,
          driver: { userId: actor.id },
        },
      }),
    );
    expect(result.id).toBe(assignmentId);
    expect(result.taskLocation).toEqual({
      kind: 'PICKUP',
      label: 'Điểm lấy hàng · Sender',
      address: '1 Main, Ward, District, HCM',
      latitude: 10.7769,
      longitude: 106.7009,
    });
  });
});
