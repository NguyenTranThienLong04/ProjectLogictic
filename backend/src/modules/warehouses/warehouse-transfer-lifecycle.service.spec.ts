import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import {
  Prisma,
  LineHaulTripStatus,
  ShipmentStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { ShipmentTransitionPolicy } from '../assignments/shipment-transition.policy.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { WarehouseTransferFlowPolicy } from './warehouse-transfer-flow.policy.js';
import { WarehouseTransferLifecycleService } from './warehouse-transfer-lifecycle.service.js';

describe('Warehouse transfer canonical departure and legacy receipt', () => {
  const actor = {
    id: 'staff',
    role: UserRole.WAREHOUSE_STAFF,
    email: 'staff@example.test',
    fullName: 'Staff',
    status: UserStatus.ACTIVE,
    tokenVersion: 0,
    mustChangePassword: false,
  };
  const cutover = '2026-01-01T00:00:00.000Z';
  function fixture(
    status: WarehouseTransferStatus = WarehouseTransferStatus.PENDING,
    configuredCutover = cutover,
  ) {
    const transfer = {
      id: 'transfer',
      shipmentId: 'shipment',
      fromWarehouseId: 'origin',
      toWarehouseId: 'destination',
      status,
      dispatchedAt:
        status === WarehouseTransferStatus.PENDING ? null : new Date('2025-12-31T23:59:59Z'),
      fromWarehouse: { isActive: true, name: 'A' },
      toWarehouse: { isActive: true, name: 'B', code: 'B' },
      shipment: {
        id: 'shipment',
        trackingCode: 'SHP',
        customerId: 'customer',
        version: 1,
        status:
          status === WarehouseTransferStatus.PENDING
            ? ShipmentStatus.AT_ORIGIN_WAREHOUSE
            : ShipmentStatus.IN_TRANSIT,
        currentWarehouseId: status === WarehouseTransferStatus.PENDING ? 'origin' : null,
        destinationWarehouseId: 'destination',
      },
    };
    const assignment = {
      tripId: 'trip',
      trip: {
        id: 'trip',
        status: LineHaulTripStatus.ARRIVED as LineHaulTripStatus,
        originWarehouseId: 'origin',
        destinationWarehouseId: 'destination',
      },
    };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      warehouseTransfer: {
        findUnique: jest.fn(() => Promise.resolve(transfer)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(transfer)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      shipment: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      lineHaulTripTransfer: {
        findFirst: jest.fn<() => Promise<typeof assignment | null>>(() => Promise.resolve(null)),
      },
      trackingEvent: { create: jest.fn(() => Promise.resolve({})) },
      auditLog: { create: jest.fn(() => Promise.resolve({})) },
    };
    const service = new WarehouseTransferLifecycleService(
      new ShipmentTransitionPolicy(),
      { createIdempotent: jest.fn(() => Promise.resolve([])) } as unknown as NotificationsService,
      new WarehouseTransferFlowPolicy(
        new ConfigService({ LINE_HAUL_ENFORCEMENT_FROM: configuredCutover }),
      ),
    );
    const receive = (warehouseId = 'destination') =>
      service.receive(tx as unknown as Prisma.TransactionClient, {
        warehouseId,
        transferId: 'transfer',
        actor,
        context: {},
        dto: {},
      });
    const dispatch = (lineHaulTripId?: string) =>
      service.dispatch(tx as unknown as Prisma.TransactionClient, {
        warehouseId: 'origin',
        transferId: 'transfer',
        actor,
        context: {},
        lineHaulTripId,
      });
    return { transfer, assignment, tx, receive, dispatch };
  }

  it('rejects standalone departure without writes and allows compatibility departure', async () => {
    const strict = fixture();
    await expect(strict.dispatch()).rejects.toMatchObject({
      response: { code: 'LINE_HAUL_TRIP_REQUIRED' },
    });
    expect(strict.tx.shipment.updateMany).not.toHaveBeenCalled();
    expect(strict.tx.auditLog.create).not.toHaveBeenCalled();
    const compatibility = fixture(WarehouseTransferStatus.PENDING, '');
    await expect(compatibility.dispatch()).resolves.toMatchObject({ transitioned: true });
  });

  it('allows only the owning dispatched manifest and rejects missing/wrong ownership', async () => {
    const f = fixture();
    await expect(f.dispatch('trip')).rejects.toMatchObject({
      response: { code: 'LINE_HAUL_MANIFEST_OWNERSHIP_INVALID' },
    });
    f.assignment.trip.status = LineHaulTripStatus.IN_TRANSIT;
    f.tx.lineHaulTripTransfer.findFirst.mockResolvedValue(f.assignment);
    await expect(f.dispatch('other-trip')).rejects.toThrow();
    await expect(f.dispatch()).rejects.toThrow();
    await expect(f.dispatch('trip')).resolves.toMatchObject({ transitioned: true });
  });

  it('receives legacy standalone with explicit audit metadata; duplicate receive is a no-op', async () => {
    const f = fixture(WarehouseTransferStatus.IN_TRANSIT);
    await expect(f.receive('wrong')).rejects.toThrow();
    await expect(f.receive()).resolves.toMatchObject({ transitioned: true });
    expect(f.tx.auditLog.create.mock.calls[0]).toMatchObject([
      {
        data: {
          metadata: {
            flow: 'LEGACY_STANDALONE',
            enforcementFrom: cutover,
            dispatchedAt: '2025-12-31T23:59:59.000Z',
          },
        },
      },
    ]);
    f.transfer.status = WarehouseTransferStatus.COMPLETED;
    await expect(f.receive()).resolves.toMatchObject({ transitioned: false });
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    await expect(f.dispatch()).resolves.toMatchObject({ transitioned: false });
  });

  it('rejects unproven or post-cutover standalone receipt', async () => {
    const f = fixture(WarehouseTransferStatus.IN_TRANSIT);
    f.transfer.dispatchedAt = new Date(cutover);
    await expect(f.receive()).rejects.toThrow();
    f.transfer.dispatchedAt = null;
    await expect(f.receive()).rejects.toThrow();
    expect(f.tx.warehouseTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('requires ARRIVED and exact route even for pre-cutover linked transfers', async () => {
    const f = fixture(WarehouseTransferStatus.IN_TRANSIT);
    f.tx.lineHaulTripTransfer.findFirst.mockResolvedValue(f.assignment);
    f.assignment.trip.status = LineHaulTripStatus.IN_TRANSIT;
    await expect(f.receive()).rejects.toMatchObject({
      response: { code: 'LINE_HAUL_TRIP_NOT_ARRIVED' },
    });
    f.assignment.trip.status = LineHaulTripStatus.ARRIVED;
    f.assignment.trip.destinationWarehouseId = 'wrong';
    await expect(f.receive()).rejects.toThrow();
    f.assignment.trip.destinationWarehouseId = 'destination';
    await expect(f.receive()).resolves.toMatchObject({ transitioned: true });
  });
});
