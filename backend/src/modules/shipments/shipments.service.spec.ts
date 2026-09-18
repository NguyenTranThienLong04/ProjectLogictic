import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  Prisma,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  TrackingVisibility,
  UserRole,
  type PricingConfig,
  type Shipment,
  type TrackingEvent,
} from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { CacheService } from '../../redis/cache.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PricingService } from '../pricing/pricing.service.js';
import { CancellationPolicy } from './cancellation.policy.js';
import type { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { ShipmentsService } from './shipments.service.js';
import type { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';

const customerId = '210e5c56-6639-46a3-98dd-dd6e3da0498d';
const shipmentId = '4bbc2439-c2f8-43c3-a979-70339603f63b';
const requestId = 'f44bab3c-eaa7-4ac8-b96f-9d00458983dd';
const user: AuthenticatedUser = {
  id: customerId,
  email: 'customer@example.com',
  fullName: 'Nguyễn Văn An',
  role: UserRole.CUSTOMER,
  mustChangePassword: false,
};

const pricingConfig: PricingConfig = {
  id: '48adbe6f-b960-4427-910d-b81795ad1a40',
  version: 1,
  baseFee: 30_000,
  includedWeightGrams: 1_000,
  extraWeightFeePerKg: 5_000,
  codFeeBasisPoints: 50,
  distanceFee: 0,
  surcharge: 0,
  discount: 0,
  isActive: true,
  createdById: null,
  createdAt: new Date('2026-08-17T08:00:00.000Z'),
};

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  const now = new Date('2026-08-17T08:00:00.000Z');
  return {
    id: shipmentId,
    trackingCode: 'SHP-20260817-A1B2C3D4',
    clientRequestId: requestId,
    customerId,
    senderSnapshot: { fullName: 'Nguyễn Văn An', email: user.email, phone: '0901234567' },
    receiverSnapshot: { fullName: 'Trần Thị Bình', phone: '0912345678' },
    pickupSnapshot: {
      contactName: 'Nguyễn Văn An',
      phone: '0901234567',
      streetAddress: '1 Lê Lợi',
      ward: 'Bến Nghé',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
    },
    deliverySnapshot: {
      contactName: 'Trần Thị Bình',
      phone: '0912345678',
      streetAddress: '2 Tràng Tiền',
      ward: 'Tràng Tiền',
      district: 'Hoàn Kiếm',
      city: 'Hà Nội',
    },
    packageSnapshot: {
      description: 'Quần áo',
      packageType: 'PARCEL',
      weightGrams: 1001,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    },
    pricingSnapshot: {
      configVersion: 1,
      baseFee: 30000,
      distanceFee: 0,
      weightFee: 5000,
      codFee: 501,
      surcharge: 0,
      discount: 0,
      totalFee: 35501,
    },
    codAmount: 100_001,
    totalFee: 35_501,
    shippingFeePayer: ShippingFeePayer.SENDER,
    status: ShipmentStatus.PENDING,
    version: 0,
    originWarehouseId: null,
    destinationWarehouseId: null,
    currentWarehouseId: null,
    returnWarehouseId: null,
    cancelledById: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationPreviousStatus: null,
    confirmedAt: null,
    pickedUpAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function event(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    id: '55fc1bc1-8105-47e4-922f-54bfab445fd7',
    shipmentId,
    status: ShipmentStatus.PENDING,
    type: 'SHIPMENT_CREATED',
    title: 'Đã tạo vận đơn',
    description: 'Vận đơn đang chờ điều phối xác nhận.',
    visibility: TrackingVisibility.PUBLIC,
    actorId: customerId,
    warehouseId: null,
    createdAt: new Date('2026-08-17T08:00:00.000Z'),
    ...overrides,
  };
}

function shippingFeeTransaction(
  status: ShippingFeeTransactionStatus = ShippingFeeTransactionStatus.PENDING,
) {
  const collected = status === ShippingFeeTransactionStatus.COLLECTED;
  const cancelled = status === ShippingFeeTransactionStatus.CANCELLED;
  return {
    id: '78ac55db-2522-4e81-9366-42e64b97da45',
    shipmentId,
    payer: ShippingFeePayer.SENDER,
    expectedAmount: 35_501,
    collectedAmount: collected ? 35_501 : null,
    status,
    collectedByDriverId: collected ? '8772b03b-3491-48d0-b217-ccab2e18a7fb' : null,
    collectedAt: collected ? new Date('2026-08-17T08:30:00.000Z') : null,
    cancelledAt: cancelled ? new Date('2026-08-17T09:00:00.000Z') : null,
    createdAt: new Date('2026-08-17T08:00:00.000Z'),
    updatedAt: new Date('2026-08-17T08:00:00.000Z'),
  };
}

const dto: CreateShipmentDto = {
  clientRequestId: requestId,
  pickupAddressId: '2a8d332c-3460-46c3-934a-2978239230c8',
  deliveryAddress: {
    contactName: ' Trần Thị Bình ',
    phone: ' 0912345678 ',
    streetAddress: ' 2 Tràng Tiền ',
    ward: ' Tràng Tiền ',
    district: ' Hoàn Kiếm ',
    city: ' Hà Nội ',
    latitude: 21.0285,
    longitude: 105.8542,
  },
  package: {
    description: ' Quần áo ',
    packageType: 'parcel',
    weightGrams: 1001,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
  },
  codAmount: 100_001,
  shippingFeePayer: ShippingFeePayer.SENDER,
};

function cacheService(overrides: Partial<CacheService> = {}): CacheService {
  return {
    shipmentTtlSeconds: 60,
    trackingTtlSeconds: 60,
    shipmentSummaryKey: jest.fn((id: string) => `shipment:${id}:summary`),
    trackingKey: jest.fn((code: string) => `tracking:${code}`),
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    invalidateShipment: jest.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as CacheService;
}

function notificationsService(): NotificationsService {
  return {
    createIdempotent: jest.fn(() => Promise.resolve([])),
    publishByEventKeys: jest.fn(() => Promise.resolve()),
  } as unknown as NotificationsService;
}

function serviceWith(
  prisma: PrismaService,
  cache = cacheService(),
  notifications = notificationsService(),
): ShipmentsService {
  return new ShipmentsService(
    prisma,
    new PricingService(prisma),
    new CancellationPolicy(),
    cache,
    notifications,
    {
      createPending: jest.fn(() => Promise.resolve({})),
      cancelPending: jest.fn(() => Promise.resolve()),
    } as unknown as ShippingFeesService,
  );
}

describe('ShipmentsService', () => {
  it('recalculates pricing and atomically creates snapshots, tracking, and audit history', async () => {
    const created = shipment();
    const withTimeline = {
      ...created,
      trackingEvents: [event()],
      shippingFeeTransaction: shippingFeeTransaction(),
    };
    const transaction = {
      shipment: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<Shipment>>(() =>
          Promise.resolve(created),
        ),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(withTimeline)),
      },
      customerAddress: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            contactName: 'Nguyễn Văn An',
            phone: '0901234567',
            streetAddress: '1 Lê Lợi',
            ward: 'Bến Nghé',
            district: 'Quận 1',
            city: 'Hồ Chí Minh',
            latitude: new Prisma.Decimal(10.7769),
            longitude: new Prisma.Decimal(106.7009),
          }),
        ),
      },
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: customerId,
            email: user.email,
            fullName: user.fullName,
            phone: '0901234567',
          }),
        ),
      },
      pricingConfig: { findFirst: jest.fn(() => Promise.resolve(pricingConfig)) },
      trackingEvent: { create: jest.fn(() => Promise.resolve(event())) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await serviceWith(prisma).create(user, dto, {});

    expect(result.totalFee).toBe(35_501);
    const createData = transaction.shipment.create.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({
      customerId,
      clientRequestId: requestId,
      codAmount: 100_001,
      totalFee: 35_501,
      shippingFeePayer: ShippingFeePayer.SENDER,
    });
    expect(createData?.pickupSnapshot).toMatchObject({ latitude: 10.7769, longitude: 106.7009 });
    const savedAddress = (await transaction.customerAddress.findFirst.mock.results[0].value) as {
      latitude: Prisma.Decimal;
      longitude: Prisma.Decimal;
    };
    savedAddress.latitude = new Prisma.Decimal(21);
    savedAddress.longitude = new Prisma.Decimal(105);
    expect(createData?.pickupSnapshot).toMatchObject({ latitude: 10.7769, longitude: 106.7009 });
    expect(createData?.pricingSnapshot).toEqual({
      configVersion: 1,
      baseFee: 30_000,
      distanceFee: 0,
      weightFee: 5_000,
      codFee: 501,
      surcharge: 0,
      discount: 0,
      totalFee: 35_501,
    });
    expect(createData?.pickupSnapshot).toMatchObject({
      city: 'Hồ Chí Minh',
      latitude: 10.7769,
      longitude: 106.7009,
    });
    expect(createData?.deliverySnapshot).toMatchObject({
      city: 'Hà Nội',
      latitude: 21.0285,
      longitude: 105.8542,
    });
    expect(transaction.trackingEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('scopes shipment detail to the authenticated customer', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = { shipment: { findFirst } } as unknown as PrismaService;
    const getCache = jest.fn(() => Promise.resolve(null));
    const get: CacheService['get'] = async () => {
      await getCache();
      return null;
    };
    const cache = cacheService({ get });

    await expect(
      serviceWith(prisma, cache).getOwned(customerId, shipmentId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: shipmentId, customerId },
      select: { id: true },
    });
    expect(getCache).not.toHaveBeenCalled();
  });

  it('cancels with optimistic concurrency and appends tracking and audit records', async () => {
    const current = shipment();
    const cancelled = shipment({
      status: ShipmentStatus.CANCELLED,
      version: 1,
      cancelledById: customerId,
      cancelledAt: new Date('2026-08-17T09:00:00.000Z'),
      cancellationReason: 'Không còn nhu cầu',
      cancellationPreviousStatus: ShipmentStatus.PENDING,
    });
    const transaction = {
      shipment: {
        findFirst: jest.fn(() => Promise.resolve(current)),
        updateMany: jest.fn<
          (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>
        >(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            ...cancelled,
            trackingEvents: [event(), event({ status: ShipmentStatus.CANCELLED })],
            shippingFeeTransaction: shippingFeeTransaction(ShippingFeeTransactionStatus.CANCELLED),
          }),
        ),
      },
      trackingEvent: { create: jest.fn(() => Promise.resolve(event())) },
      auditLog: { create: jest.fn(() => Promise.resolve({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await serviceWith(prisma).cancel(
      user,
      shipmentId,
      { reason: ' Không còn nhu cầu ' },
      {},
    );

    expect(result.status).toBe(ShipmentStatus.CANCELLED);
    const updateCall = transaction.shipment.updateMany.mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({
      id: shipmentId,
      customerId,
      status: ShipmentStatus.PENDING,
      version: 0,
    });
    expect(updateCall?.data).toMatchObject({
      status: ShipmentStatus.CANCELLED,
      cancellationPreviousStatus: ShipmentStatus.PENDING,
      cancellationReason: 'Không còn nhu cầu',
    });
    expect(transaction.trackingEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns only public tracking fields and public timeline events', async () => {
    const prisma = {
      shipment: {
        findUnique: jest.fn(() => Promise.resolve({ ...shipment(), trackingEvents: [event()] })),
      },
    } as unknown as PrismaService;

    const result = await serviceWith(prisma).publicTracking('shp-20260817-a1b2c3d4');

    expect(result).toEqual(
      expect.objectContaining({
        trackingCode: 'SHP-20260817-A1B2C3D4',
        originCity: 'Hồ Chí Minh',
        destinationCity: 'Hà Nội',
      }),
    );
    expect(result).not.toHaveProperty('customerId');
    expect(result).not.toHaveProperty('receiver');
    expect(result).not.toHaveProperty('auditLogs');
  });

  it('serves normalized public tracking from Redis without querying PostgreSQL on a hit', async () => {
    const cached = {
      trackingCode: 'SHP-20260817-A1B2C3D4',
      status: ShipmentStatus.PENDING,
      originCity: 'Há»“ ChÃ­ Minh',
      destinationCity: 'HÃ  Ná»™i',
      createdAt: new Date('2026-08-17T08:00:00.000Z'),
      timeline: [],
    };
    const findUnique = jest.fn();
    const prisma = { shipment: { findUnique } } as unknown as PrismaService;
    const getCache = jest.fn(() => Promise.resolve(cached));
    const get: CacheService['get'] = async <T>() => (await getCache()) as T;
    const trackingKey = jest.fn((code: string) => `tracking:${code}`);
    const cache = cacheService({ get, trackingKey });

    await expect(
      serviceWith(prisma, cache).publicTracking(' shp-20260817-a1b2c3d4 '),
    ).resolves.toEqual(cached);
    expect(trackingKey).toHaveBeenCalledWith('SHP-20260817-A1B2C3D4');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
