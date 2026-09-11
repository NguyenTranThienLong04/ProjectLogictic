import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  ShipmentStatus,
  UserRole,
  UserStatus,
  WarehouseTransferStatus,
} from '../../generated/prisma/client.js';
import { ShipmentTransitionPolicy } from '../assignments/shipment-transition.policy.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { WarehousesService } from './warehouses.service.js';
import { WarehouseTransferLifecycleService } from './warehouse-transfer-lifecycle.service.js';

type MockFunction = jest.Mock<(...args: never[]) => Promise<unknown>>;
type MockRepository = Record<string, MockFunction>;
type PrismaMock = {
  warehouse: MockRepository;
  user: MockRepository;
  warehouseStaffProfile: MockRepository;
  shipment: MockRepository;
  warehouseTransfer: MockRepository;
  lineHaulTripTransfer: MockRepository;
  trackingEvent: MockRepository;
  auditLog: MockRepository;
  $transaction: MockFunction;
  $queryRaw: MockFunction;
};
type NotificationsMock = {
  createIdempotent: MockFunction;
  publishByEventKeys: MockFunction;
  publishShipmentUpdated: MockFunction;
};

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: PrismaMock;
  let transitionPolicy: ShipmentTransitionPolicy;
  let notifications: NotificationsMock;

  const mockAdmin = {
    id: 'admin-uuid-1',
    role: UserRole.ADMIN,
    email: 'admin@test.com',
    fullName: 'Admin User',
    status: UserStatus.ACTIVE,
    tokenVersion: 0,
    mustChangePassword: false,
  };

  const mockStaff = {
    id: 'staff-uuid-1',
    role: UserRole.WAREHOUSE_STAFF,
    email: 'staff@test.com',
    fullName: 'Staff User',
    status: UserStatus.ACTIVE,
    tokenVersion: 0,
    mustChangePassword: false,
  };

  const mockContext = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };

  beforeEach(() => {
    prisma = {
      warehouse: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      warehouseStaffProfile: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      shipment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        count: jest.fn(),
      },
      warehouseTransfer: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      lineHaulTripTransfer: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      trackingEvent: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') {
          return (input as (transaction: typeof prisma) => unknown)(prisma);
        }
        return Promise.all(input as readonly Promise<unknown>[]);
      }),
      $queryRaw: jest.fn(() => Promise.resolve([])),
    };

    transitionPolicy = new ShipmentTransitionPolicy();
    notifications = {
      createIdempotent: jest.fn(() => Promise.resolve([])),
      publishByEventKeys: jest.fn(() => Promise.resolve()),
      publishShipmentUpdated: jest.fn(() => Promise.resolve()),
    };

    service = new WarehousesService(
      prisma as unknown as PrismaService,
      transitionPolicy,
      notifications as unknown as NotificationsService,
      new WarehouseTransferLifecycleService(
        transitionPolicy,
        notifications as unknown as NotificationsService,
      ),
    );
  });

  describe('createWarehouse', () => {
    it('creates a new warehouse and records audit log', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(null);
      prisma.warehouse.create.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-HAN-01',
        name: 'Hanoi Hub',
        address: '123 Main St',
        ward: 'Dich Vong',
        district: 'Cau Giay',
        city: 'Hà Nội',
        latitude: 21.028,
        longitude: 105.804,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createWarehouse(
        {
          code: 'WH-HAN-01',
          name: 'Hanoi Hub',
          address: '123 Main St',
          city: 'Hà Nội',
        },
        mockAdmin,
        mockContext,
      );

      expect(result.code).toBe('WH-HAN-01');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('rejects duplicate warehouse code', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' });

      await expect(
        service.createWarehouse(
          {
            code: 'WH-HAN-01',
            name: 'Hanoi Hub',
            address: '123 Main St',
            city: 'Hà Nội',
          },
          mockAdmin,
          mockContext,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('assignStaff', () => {
    it('assigns a WAREHOUSE_STAFF user to warehouse', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'staff-1',
        role: UserRole.WAREHOUSE_STAFF,
        warehouseStaffProfile: null,
      });
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue(null);
      prisma.warehouseStaffProfile.findUniqueOrThrow.mockResolvedValue({
        id: 'prof-1',
        userId: 'staff-1',
        warehouseId: 'wh-1',
        staffCode: 'STF-HAN-001',
        isActive: true,
        createdAt: new Date(),
        user: { id: 'staff-1', fullName: 'Staff One', email: 's@test.com', phone: null },
        warehouse: { id: 'wh-1', code: 'WH-HAN-01', name: 'Hanoi Hub', city: 'Hà Nội' },
      });

      const result = await service.assignStaff(
        'wh-1',
        { userId: 'staff-1', staffCode: 'STF-HAN-001' },
        mockAdmin,
        mockContext,
      );

      expect(result.staffCode).toBe('STF-HAN-001');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('rejects assignment if user is not WAREHOUSE_STAFF', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'cust-1',
        role: UserRole.CUSTOMER,
      });

      await expect(
        service.assignStaff(
          'wh-1',
          { userId: 'cust-1', staffCode: 'STF-HAN-001' },
          mockAdmin,
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('atomic admin mutations', () => {
    it('updates a warehouse and its audit record in one transaction', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-1',
        name: 'Old name',
        address: 'Old address',
        city: 'Hanoi',
        isActive: true,
        version: 2,
      });
      prisma.warehouse.findUniqueOrThrow.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-HAN-01',
        name: 'New name',
        address: 'Old address',
        ward: null,
        district: null,
        city: 'Hanoi',
        latitude: null,
        longitude: null,
        isActive: true,
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.updateWarehouse('wh-1', { name: 'New name' }, mockAdmin, mockContext);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a stale warehouse update before writing audit history', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-1',
        name: 'Old name',
        address: 'Old address',
        city: 'Hanoi',
        isActive: true,
        version: 2,
      });
      prisma.warehouse.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateWarehouse('wh-1', { name: 'New name' }, mockAdmin, mockContext),
      ).rejects.toMatchObject({ response: { code: 'WAREHOUSE_CONCURRENT_MODIFICATION' } });

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('toggles a warehouse and its audit record in one transaction', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1', isActive: true, version: 2 });
      prisma.warehouse.findUniqueOrThrow.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-HAN-01',
        name: 'Hanoi Hub',
        address: '123 Main St',
        ward: null,
        district: null,
        city: 'Hanoi',
        latitude: null,
        longitude: null,
        isActive: false,
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.toggleWarehouseStatus('wh-1', mockAdmin, mockContext);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('toggles warehouse staff and its audit record in one transaction', async () => {
      const profile = {
        id: 'prof-1',
        userId: 'staff-1',
        warehouseId: 'wh-1',
        staffCode: 'STF-HAN-001',
        isActive: true,
        version: 4,
        createdAt: new Date(),
        user: { id: 'staff-1', fullName: 'Staff One', email: 's@test.com', phone: null },
        warehouse: { id: 'wh-1', code: 'WH-HAN-01', name: 'Hanoi Hub', city: 'Hanoi' },
      };
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue(profile);
      prisma.warehouseStaffProfile.findUniqueOrThrow.mockResolvedValue({
        ...profile,
        isActive: false,
        version: 5,
      });

      await service.toggleStaffStatus('prof-1', mockAdmin, mockContext);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkIn', () => {
    it('performs origin check-in for PICKED_UP shipment and verifies package', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-HAN-01',
        name: 'Hanoi Hub',
        isActive: true,
      });
      prisma.shipment.findFirst.mockResolvedValue({
        id: 'shp-1',
        trackingCode: 'SHP-20260817-A1B2C3',
        status: ShipmentStatus.PICKED_UP,
        originWarehouseId: 'wh-1',
        currentWarehouseId: null,
        destinationWarehouseId: null,
        packageSnapshot: { weightGrams: 1000 },
        version: 1,
      });
      prisma.shipment.findUniqueOrThrow.mockResolvedValue({
        id: 'shp-1',
        trackingCode: 'SHP-20260817-A1B2C3',
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId: 'wh-1',
        currentWarehouseId: 'wh-1',
        packageSnapshot: { weightGrams: 1000, verifiedWeightGrams: 1200 },
      });

      const result = await service.checkIn(
        'wh-1',
        {
          trackingCode: 'SHP-20260817-A1B2C3',
          packageVerified: true,
          actualWeightGrams: 1200,
          lengthCm: 20,
          widthCm: 15,
          heightCm: 10,
          note: 'Checked at origin',
        },
        mockStaff,
        mockContext,
      );

      expect(result.idempotent).toBe(false);
      expect(result.shipment.status).toBe(ShipmentStatus.AT_ORIGIN_WAREHOUSE);
    });

    it('rejects staff trying to check-in at another warehouse', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });

      await expect(
        service.checkIn(
          'wh-2',
          {
            trackingCode: 'SHP-1',
            packageVerified: true,
            actualWeightGrams: 1000,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
          },
          mockStaff,
          mockContext,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids check-in at the staff warehouse when it is not the shipment origin', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-2',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-2', isActive: true });
      prisma.shipment.findFirst.mockResolvedValue({
        id: 'shp-1',
        trackingCode: 'SHP-1',
        status: ShipmentStatus.PICKED_UP,
        originWarehouseId: 'wh-1',
        currentWarehouseId: null,
        driverAssignments: [],
      });

      await expect(
        service.checkIn(
          'wh-2',
          {
            trackingCode: 'SHP-1',
            packageVerified: true,
            actualWeightGrams: 1000,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
          },
          mockStaff,
          mockContext,
        ),
      ).rejects.toMatchObject({ response: { code: 'ORIGIN_WAREHOUSE_MISMATCH' } });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns idempotent result if shipment already checked in at this warehouse', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-1',
        isActive: true,
      });
      prisma.shipment.findFirst.mockResolvedValue({
        id: 'shp-1',
        trackingCode: 'SHP-1',
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        originWarehouseId: 'wh-1',
        currentWarehouseId: 'wh-1',
      });

      const result = await service.checkIn(
        'wh-1',
        {
          trackingCode: 'SHP-1',
          packageVerified: true,
          actualWeightGrams: 1000,
          lengthCm: 10,
          widthCm: 10,
          heightCm: 10,
        },
        mockStaff,
        mockContext,
      );

      expect(result.idempotent).toBe(true);
    });

    it('rejects a stale check-in before writing tracking or audit history', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1', isActive: true });
      prisma.shipment.findFirst.mockResolvedValue({
        id: 'shp-1',
        trackingCode: 'SHP-1',
        customerId: 'customer-1',
        status: ShipmentStatus.PICKED_UP,
        originWarehouseId: 'wh-1',
        destinationWarehouseId: null,
        currentWarehouseId: null,
        packageSnapshot: { weightGrams: 1000 },
        version: 1,
      });
      prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.checkIn(
          'wh-1',
          {
            trackingCode: 'SHP-1',
            packageVerified: true,
            actualWeightGrams: 1000,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
          },
          mockStaff,
          mockContext,
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_CONCURRENT_MODIFICATION' } });

      expect(prisma.trackingEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('transfers', () => {
    it('rejects reuse of a transfer idempotency key with a different payload', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue({
        shipmentId: 'other-shipment',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
      });

      await expect(
        service.createTransfer(
          'wh-1',
          {
            shipmentId: 'shp-1',
            toWarehouseId: 'wh-2',
            clientRequestId: 'req-uuid-1',
          },
          mockStaff,
          mockContext,
        ),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a pending inter-warehouse transfer without moving the shipment', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue(null);
      prisma.warehouse.findUnique
        .mockResolvedValueOnce({ id: 'wh-1', name: 'Hanoi Hub', isActive: true })
        .mockResolvedValueOnce({ id: 'wh-2', name: 'Danang Hub', isActive: true });

      prisma.shipment.findUnique.mockResolvedValue({
        id: 'shp-1',
        currentWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
      });

      prisma.warehouseTransfer.create.mockResolvedValue({
        id: 'trf-1',
        transferCode: 'TRF-001',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.shipment.update.mockResolvedValue({});

      const result = await service.createTransfer(
        'wh-1',
        {
          shipmentId: 'shp-1',
          toWarehouseId: 'wh-2',
          clientRequestId: 'req-uuid-1',
          note: 'Night transit',
        },
        mockStaff,
        mockContext,
      );

      expect(result.transferCode).toBe('TRF-001');
      expect(result.status).toBe(WarehouseTransferStatus.PENDING);
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(prisma.trackingEvent.create).not.toHaveBeenCalled();
    });

    it('rejects transfer when origin and destination are the same', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue(null);

      await expect(
        service.createTransfer(
          'wh-1',
          {
            shipmentId: 'shp-1',
            toWarehouseId: 'wh-1',
            clientRequestId: 'req-uuid-1',
          },
          mockStaff,
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('dispatches a pending transfer and clears currentWarehouseId atomically', async () => {
      const createdAt = new Date('2026-09-02T08:00:00.000Z');
      const pendingTransfer = {
        id: 'trf-1',
        transferCode: 'TRF-001',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.PENDING,
        note: 'Night transit',
        clientRequestId: 'req-uuid-1',
        createdById: mockStaff.id,
        dispatchedById: null,
        dispatchedAt: null,
        receivedById: null,
        receivedAt: null,
        createdAt,
        updatedAt: createdAt,
        shipment: {
          id: 'shp-1',
          trackingCode: 'SHP-1',
          customerId: 'customer-1',
          status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
          version: 3,
          currentWarehouseId: 'wh-1',
          destinationWarehouseId: 'wh-2',
          totalFee: 30_000,
          codAmount: 0,
          senderSnapshot: {},
          receiverSnapshot: {},
        },
        fromWarehouse: {
          id: 'wh-1',
          code: 'WH-1',
          name: 'Hanoi Hub',
          city: 'Hanoi',
          isActive: true,
        },
        toWarehouse: {
          id: 'wh-2',
          code: 'WH-2',
          name: 'Danang Hub',
          city: 'Danang',
          isActive: true,
        },
        dispatchedBy: null,
        receivedBy: null,
      };
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-1',
        name: 'Hanoi Hub',
        code: 'WH-1',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue(pendingTransfer);
      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue({
        ...pendingTransfer,
        status: WarehouseTransferStatus.IN_TRANSIT,
        dispatchedById: mockStaff.id,
        dispatchedAt: createdAt,
        shipment: {
          ...pendingTransfer.shipment,
          status: ShipmentStatus.IN_TRANSIT,
          currentWarehouseId: null,
        },
      });

      const result = await service.dispatchTransfer('wh-1', 'trf-1', mockStaff, mockContext);

      expect(result.status).toBe(WarehouseTransferStatus.IN_TRANSIT);
      const [shipmentUpdate] = prisma.shipment.updateMany.mock.calls[0] as unknown as [
        { data: { status: ShipmentStatus; currentWarehouseId: string | null } },
      ];
      expect(shipmentUpdate.data).toMatchObject({
        status: ShipmentStatus.IN_TRANSIT,
        currentWarehouseId: null,
      });
      expect(prisma.trackingEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('returns an already dispatched transfer without duplicate history', async () => {
      const dispatchedAt = new Date('2026-09-02T08:00:00.000Z');
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1', isActive: true });
      prisma.warehouseTransfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        transferCode: 'TRF-001',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.IN_TRANSIT,
        note: null,
        clientRequestId: 'req-uuid-1',
        createdById: mockStaff.id,
        dispatchedById: mockStaff.id,
        dispatchedAt,
        receivedById: null,
        receivedAt: null,
        createdAt: dispatchedAt,
        updatedAt: dispatchedAt,
        shipment: { status: ShipmentStatus.IN_TRANSIT },
      });

      const result = await service.dispatchTransfer('wh-1', 'trf-1', mockStaff, mockContext);

      expect(result.status).toBe(WarehouseTransferStatus.IN_TRANSIT);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.trackingEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('receives an inbound transfer at destination warehouse', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-2',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-2',
        name: 'Danang Hub',
        code: 'WH-DAD-01',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.IN_TRANSIT,
        shipment: {
          id: 'shp-1',
          trackingCode: 'SHP-1',
          customerId: 'customer-1',
          status: ShipmentStatus.IN_TRANSIT,
          version: 3,
        },
        toWarehouse: {
          id: 'wh-2',
          name: 'Danang Hub',
          code: 'WH-DAD-01',
          isActive: true,
        },
      });

      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue({
        id: 'trf-1',
        transferCode: 'TRF-001',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.COMPLETED,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.receiveTransfer(
        'wh-2',
        'trf-1',
        { note: 'Received in good condition' },
        mockStaff,
        mockContext,
      );

      expect(result.status).toBe(WarehouseTransferStatus.COMPLETED);
    });

    it('Wrong warehouse cannot receive transfer', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-3',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-3',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.IN_TRANSIT,
      });

      await expect(
        service.receiveTransfer('wh-3', 'trf-1', {}, mockStaff, mockContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns a completed transfer idempotently without duplicate history', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-2',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-2',
        name: 'Danang Hub',
        code: 'WH-DAD-01',
        isActive: true,
      });
      prisma.warehouseTransfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        transferCode: 'TRF-001',
        shipmentId: 'shp-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        status: WarehouseTransferStatus.COMPLETED,
        note: null,
        clientRequestId: 'req-uuid-1',
        createdById: mockStaff.id,
        dispatchedById: mockStaff.id,
        dispatchedAt: new Date(),
        receivedById: mockStaff.id,
        receivedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        shipment: {
          id: 'shp-1',
          trackingCode: 'SHP-1',
          status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
          currentWarehouseId: 'wh-2',
          totalFee: 30_000,
          codAmount: 0,
          senderSnapshot: {},
          receiverSnapshot: {},
        },
        fromWarehouse: { id: 'wh-1', code: 'WH-1', name: 'Hanoi Hub', city: 'Hanoi' },
        toWarehouse: { id: 'wh-2', code: 'WH-2', name: 'Danang Hub', city: 'Danang' },
        dispatchedBy: null,
        receivedBy: null,
      });

      const result = await service.receiveTransfer('wh-2', 'trf-1', {}, mockStaff, mockContext);

      expect(result.status).toBe(WarehouseTransferStatus.COMPLETED);
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('markReadyForDelivery', () => {
    it('transitions AT_DESTINATION_WAREHOUSE to AWAITING_DELIVERY_ASSIGNMENT', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-2',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: 'wh-2',
        name: 'Danang Hub',
        code: 'WH-DAD-01',
      });
      prisma.shipment.findUnique.mockResolvedValue({
        id: 'shp-1',
        currentWarehouseId: 'wh-2',
        status: ShipmentStatus.AT_DESTINATION_WAREHOUSE,
        version: 4,
      });
      prisma.shipment.findUniqueOrThrow.mockResolvedValue({
        id: 'shp-1',
        status: ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT,
      });

      const result = await service.markReadyForDelivery('wh-2', 'shp-1', mockStaff, mockContext);

      expect(result.status).toBe(ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT);
    });

    it('does not let origin staff bypass a required inter-warehouse transfer', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1', isActive: true });
      prisma.shipment.findUnique.mockResolvedValue({
        id: 'shp-1',
        currentWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: ShipmentStatus.AT_ORIGIN_WAREHOUSE,
        version: 4,
      });

      await expect(
        service.markReadyForDelivery('wh-1', 'shp-1', mockStaff, mockContext),
      ).rejects.toMatchObject({ response: { code: 'WAREHOUSE_TRANSFER_REQUIRED' } });

      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('warehouse read scope', () => {
    const warehouse = (id: string, code: string) => ({
      id,
      code,
      name: `${code} Warehouse`,
      address: `${code} address`,
      ward: 'Ward',
      district: 'District',
      city: 'City',
      latitude: null,
      longitude: null,
      isActive: true,
      version: 0,
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      updatedAt: new Date('2026-08-26T00:00:00.000Z'),
      _count: { staffProfiles: 2, currentShipments: 3 },
    });

    it('returns only minimal catalogue fields for another warehouse', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findUnique.mockResolvedValue(warehouse('wh-2', 'WH-2'));

      await expect(service.getWarehouse('wh-2', mockStaff)).resolves.toEqual({
        id: 'wh-2',
        code: 'WH-2',
        name: 'WH-2 Warehouse',
        address: 'WH-2 address',
      });
    });

    it('keeps the assigned warehouse full while reducing other list items', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });
      prisma.warehouse.findMany.mockResolvedValue([
        warehouse('wh-1', 'WH-1'),
        warehouse('wh-2', 'WH-2'),
      ]);
      prisma.warehouse.count.mockResolvedValue(2);

      const result = await service.listWarehouses({ page: 1, limit: 20 }, mockStaff);

      expect(result.items[0]).toMatchObject({
        id: 'wh-1',
        city: 'City',
        staffCount: 2,
        activeShipmentsCount: 3,
      });
      expect(result.items[1]).toEqual({
        id: 'wh-2',
        code: 'WH-2',
        name: 'WH-2 Warehouse',
        address: 'WH-2 address',
      });
    });

    it('keeps full catalogue responses for admins', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(warehouse('wh-2', 'WH-2'));

      await expect(service.getWarehouse('wh-2', mockAdmin)).resolves.toMatchObject({
        id: 'wh-2',
        city: 'City',
        staffCount: 2,
        activeShipmentsCount: 3,
      });
      expect(prisma.warehouseStaffProfile.findUnique).not.toHaveBeenCalled();
    });

    it('does not let staff read another warehouse inventory, transfers, or inbound queue', async () => {
      prisma.warehouseStaffProfile.findUnique.mockResolvedValue({
        userId: mockStaff.id,
        warehouseId: 'wh-1',
        isActive: true,
      });

      await expect(
        service.listWarehouseShipments('wh-2', { page: 1, limit: 20 }, mockStaff),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.listTransfers('wh-2', 'all', mockStaff)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.listInboundQueue('wh-2', mockStaff)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.listExceptions('wh-2', { page: 1, limit: 20 }, mockStaff),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.shipment.findMany).not.toHaveBeenCalled();
      expect(prisma.warehouseTransfer.findMany).not.toHaveBeenCalled();
    });
  });
});
