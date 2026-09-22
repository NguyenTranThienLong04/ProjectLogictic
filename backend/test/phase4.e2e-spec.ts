import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DriverStatus,
  ShipmentStatus,
  UserRole,
  WarehouseTransferStatus,
} from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

const mockLocationValues = new Map<string, string>();
const mockRedisService = {
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
  getClient: jest.fn().mockReturnValue({
    status: 'ready',
    get: jest.fn((key: string) => Promise.resolve(mockLocationValues.get(key) ?? null)),
    mget: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((key) => mockLocationValues.get(key) ?? null)),
    ),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
  }),
};

interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

interface WarehouseStaffAssignment {
  warehouseId: string;
  warehouse: { id: string };
}
interface WarehouseCatalogueItem {
  id: string;
  code: string;
  name: string;
  address: string;
  staffCount?: number;
  activeShipmentsCount?: number;
  city?: string;
}
interface WarehouseCatalogueResponse {
  items: WarehouseCatalogueItem[];
}
interface AssignmentStatusResponse {
  status: string;
}
interface ShipmentWarehouseState {
  status: ShipmentStatus;
  originWarehouseId: string | null;
  currentWarehouseId: string | null;
  destinationWarehouseId: string | null;
}
interface CheckInResponse {
  idempotent: boolean;
  shipment: ShipmentWarehouseState;
}
interface TrackingTimelineResponse {
  timeline: Array<{ status: ShipmentStatus }>;
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`API response envelope is missing: ${JSON.stringify(body)}`);
  }
  return body as ApiEnvelope<T>;
}

describe('Phase 4 Warehouse Network flow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let hasher: PasswordHasherService;
  const runId = randomUUID().replaceAll('-', '');

  const adminEmail = `admin-p4-${runId}@example.com`;
  const dispatcherEmail = `dispatcher-p4-${runId}@example.com`;
  const staff1Email = `staff-han-${runId}@example.com`;
  const staff2Email = `staff-sgn-${runId}@example.com`;
  const driverEmail = `driver-p4-${runId}@example.com`;
  const customerEmail = `customer-p4-${runId}@example.com`;
  const emails = [
    adminEmail,
    dispatcherEmail,
    staff1Email,
    staff2Email,
    driverEmail,
    customerEmail,
  ];

  let adminToken = '';
  let dispatcherToken = '';
  let staff1Token = '';
  let staff2Token = '';
  let driverToken = '';
  let customerToken = '';

  let staff1UserId = '';
  let staff2UserId = '';
  let driverProfileId = '';
  let originWarehouseId = '';
  let destinationWarehouseId = '';
  let shipmentId = '';
  let trackingCode = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const cookieParser = (await import('cookie-parser')).default;
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    hasher = app.get(PasswordHasherService);

    const passwordHash = await hasher.hash('Password@123456');

    // Create Admin
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'Admin User',
        role: UserRole.ADMIN,
        passwordHash,
      },
    });

    // Create Dispatcher
    await prisma.user.create({
      data: {
        email: dispatcherEmail,
        fullName: 'Dispatcher User',
        role: UserRole.DISPATCHER,
        passwordHash,
      },
    });

    // Create Warehouse Staff 1 (Hanoi)
    const staff1 = await prisma.user.create({
      data: {
        email: staff1Email,
        fullName: 'Staff Hanoi',
        role: UserRole.WAREHOUSE_STAFF,
        passwordHash,
      },
    });
    staff1UserId = staff1.id;

    // Create Warehouse Staff 2 (Saigon)
    const staff2 = await prisma.user.create({
      data: {
        email: staff2Email,
        fullName: 'Staff Saigon',
        role: UserRole.WAREHOUSE_STAFF,
        passwordHash,
      },
    });
    staff2UserId = staff2.id;

    // Create Driver
    const driverUser = await prisma.user.create({
      data: {
        email: driverEmail,
        fullName: 'Pickup Driver',
        role: UserRole.DRIVER,
        passwordHash,
      },
    });

    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        employeeCode: `DRV-P4-${runId.slice(0, 12).toUpperCase()}`,
        vehicleType: 'TRUCK',
        vehiclePlate: '29A-99999',
        status: DriverStatus.AVAILABLE,
        isOnline: true,
        isAvailable: true,
      },
    });
    driverProfileId = driverProfile.id;

    // Create Customer
    await prisma.user.create({
      data: {
        email: customerEmail,
        fullName: 'Customer User',
        role: UserRole.CUSTOMER,
        passwordHash,
      },
    });

    // Logins
    const login = async (email: string) => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password@123456' });
      return bodyFrom<{ accessToken: string }>(res).data.accessToken;
    };

    adminToken = await login(adminEmail);
    dispatcherToken = await login(dispatcherEmail);
    staff1Token = await login(staff1Email);
    staff2Token = await login(staff2Email);
    driverToken = await login(driverEmail);
    customerToken = await login(customerEmail);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.warehouseTransfer.deleteMany({
      where: {
        shipment: { customer: { email: customerEmail } },
      },
    });
    await prisma.shipmentProof.deleteMany({
      where: { shipment: { customer: { email: customerEmail } } },
    });
    await prisma.driverAssignment.deleteMany({
      where: { shipment: { customer: { email: customerEmail } } },
    });
    await prisma.trackingEvent.deleteMany({
      where: { shipment: { customer: { email: customerEmail } } },
    });
    await prisma.shippingFeeTransaction.deleteMany({
      where: { shipment: { customer: { email: customerEmail } } },
    });
    await prisma.shipment.deleteMany({
      where: { customer: { email: customerEmail } },
    });
    await prisma.warehouseStaffProfile.deleteMany({
      where: { userId: { in: [staff1UserId, staff2UserId] } },
    });
    await prisma.driverProfile.deleteMany({ where: { id: driverProfileId } });
    if (originWarehouseId || destinationWarehouseId) {
      await prisma.warehouse.deleteMany({
        where: { id: { in: [originWarehouseId, destinationWarehouseId].filter(Boolean) } },
      });
    }
    await prisma.customerAddress.deleteMany({ where: { customer: { email: customerEmail } } });
    await prisma.authSession.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.auditLog.deleteMany({ where: { actor: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('1. Admin creates Origin Warehouse (Hanoi) and Destination Warehouse (Saigon)', async () => {
    const originRes = await request(server)
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `WH-HAN-${runId.slice(0, 12).toUpperCase()}`,
        name: 'Kho Trung Chuyển Hà Nội',
        address: '123 Đường Cầu Giấy',
        ward: 'Dịch Vọng',
        district: 'Cầu Giấy',
        city: 'Hà Nội',
        latitude: 21.028511,
        longitude: 105.804817,
      })
      .expect(201);

    const originBody = bodyFrom<{ id: string; code: string }>(originRes);
    originWarehouseId = originBody.data.id;
    expect(originWarehouseId).toBeDefined();
    await prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { operatingWarehouseId: originWarehouseId },
    });
    mockLocationValues.set(
      `driver:location:${driverProfileId}`,
      JSON.stringify({
        driverId: driverProfileId,
        latitude: 21.0286,
        longitude: 105.805,
        updatedAt: new Date().toISOString(),
      }),
    );

    const destRes = await request(server)
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `WH-SGN-${runId.slice(0, 12).toUpperCase()}`,
        name: 'Kho Trung Chuyển Sài Gòn',
        address: '456 Đường Cộng Hòa',
        ward: 'Phường 13',
        district: 'Tân Bình',
        city: 'Hồ Chí Minh',
        latitude: 10.801234,
        longitude: 106.654321,
      })
      .expect(201);

    const destBody = bodyFrom<{ id: string; code: string }>(destRes);
    destinationWarehouseId = destBody.data.id;
    expect(destinationWarehouseId).toBeDefined();
  });

  it('2. Admin assigns staff to respective warehouses', async () => {
    // Assign Staff 1 to Hanoi Warehouse
    const assign1Res = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/staff`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: staff1UserId,
        staffCode: `STF-HAN-${runId.slice(0, 12).toUpperCase()}`,
      })
      .expect(201);
    expect(bodyFrom<WarehouseStaffAssignment>(assign1Res).data.warehouseId).toBe(originWarehouseId);

    // Assign Staff 2 to Saigon Warehouse
    const assign2Res = await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/staff`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: staff2UserId,
        staffCode: `STF-SGN-${runId.slice(0, 12).toUpperCase()}`,
      })
      .expect(201);
    expect(bodyFrom<WarehouseStaffAssignment>(assign2Res).data.warehouseId).toBe(
      destinationWarehouseId,
    );

    // Staff 1 checks their profile
    const profileRes = await request(server)
      .get('/api/v1/warehouses/staff/me')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(bodyFrom<WarehouseStaffAssignment>(profileRes).data.warehouse.id).toBe(
      originWarehouseId,
    );
  });

  it('3. Enforces warehouse read scope and minimizes cross-warehouse catalogue responses', async () => {
    await Promise.all([
      request(server)
        .get(`/api/v1/warehouses/${destinationWarehouseId}/shipments`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .expect(403),
      request(server)
        .get(`/api/v1/warehouses/${destinationWarehouseId}/transfers`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .expect(403),
      request(server)
        .get(`/api/v1/warehouses/${destinationWarehouseId}/inbound-queue`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .expect(403),
    ]);

    const detailResponse = await request(server)
      .get(`/api/v1/warehouses/${destinationWarehouseId}`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(bodyFrom<WarehouseCatalogueItem>(detailResponse).data).toEqual({
      id: destinationWarehouseId,
      code: `WH-SGN-${runId.slice(0, 12).toUpperCase()}`,
      name: 'Kho Trung Chuyển Sài Gòn',
      address: '456 Đường Cộng Hòa',
    });

    const listResponse = await request(server)
      .get('/api/v1/warehouses?page=1&limit=50')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    const items = bodyFrom<WarehouseCatalogueResponse>(listResponse).data.items;
    const assignedWarehouse = items.find((warehouse) => warehouse.id === originWarehouseId);
    const otherWarehouse = items.find((warehouse) => warehouse.id === destinationWarehouseId);
    expect(assignedWarehouse).toMatchObject({
      id: originWarehouseId,
      city: 'Hà Nội',
      staffCount: 1,
      activeShipmentsCount: 0,
    });
    expect(otherWarehouse).toEqual({
      id: destinationWarehouseId,
      code: `WH-SGN-${runId.slice(0, 12).toUpperCase()}`,
      name: 'Kho Trung Chuyển Sài Gòn',
      address: '456 Đường Cộng Hòa',
    });

    for (const token of [adminToken, dispatcherToken]) {
      const fullDetailResponse = await request(server)
        .get(`/api/v1/warehouses/${destinationWarehouseId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(bodyFrom<WarehouseCatalogueItem>(fullDetailResponse).data).toMatchObject({
        id: destinationWarehouseId,
        city: 'Hồ Chí Minh',
        staffCount: 1,
        activeShipmentsCount: 0,
      });
    }
  });

  it('4. Customer creates shipment and driver completes pickup to reach PICKED_UP status', async () => {
    const addressRes = await request(server)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Nhà riêng',
        contactName: 'Người gửi',
        phone: '0901234567',
        streetAddress: '123 Phố Huế',
        ward: 'Phố Huế',
        district: 'Hai Bà Trưng',
        city: 'Hà Nội',
        latitude: 21.028511,
        longitude: 105.804817,
        isDefault: true,
      })
      .expect(201);

    const addressId = bodyFrom<{ id: string }>(addressRes).data.id;

    const shipmentRes = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        clientRequestId: '7e6b797d-bb62-430c-9694-1a9bf1c172d1',
        pickupAddressId: addressId,
        deliveryAddress: {
          contactName: 'Người nhận Sài Gòn',
          phone: '0912345678',
          streetAddress: '789 Lê Lợi',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        },
        package: {
          description: 'Linh kiện máy chủ',
          packageType: 'ELECTRONICS',
          weightGrams: 2000,
          lengthCm: 30,
          widthCm: 20,
          heightCm: 15,
        },
        codAmount: 500000,
        shippingFeePayer: 'RECEIVER',
      })
      .expect(201);

    const createdShipment = bodyFrom<{ id: string; trackingCode: string }>(shipmentRes).data;
    shipmentId = createdShipment.id;
    trackingCode = createdShipment.trackingCode;

    // Dispatcher confirms
    await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/confirm`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);

    mockLocationValues.set(
      `driver:location:${driverProfileId}`,
      JSON.stringify({
        driverId: driverProfileId,
        latitude: 21.0286,
        longitude: 105.805,
        updatedAt: new Date().toISOString(),
      }),
    );

    // Dispatcher assigns pickup driver
    const assignRes = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipmentId}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        driverId: driverProfileId,
        clientRequestId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      })
      .expect(201);

    const assignmentId = bodyFrom<{ id: string }>(assignRes).data.id;

    // Driver accepts
    await request(server)
      .post(`/api/v1/driver/assignments/${assignmentId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    // Driver completes pickup
    const pickupRes = await request(server)
      .post(`/api/v1/driver/assignments/${assignmentId}/pickup`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        note: 'Đã nhận hàng nguyên kiện tại địa chỉ gửi',
      })
      .expect(200);

    expect(bodyFrom<AssignmentStatusResponse>(pickupRes).data.status).toBe('COMPLETED');

    const pickedUpShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(pickedUpShipment.status).toBe(ShipmentStatus.PICKED_UP);
    expect(pickedUpShipment.originWarehouseId).toBe(originWarehouseId);
    expect(pickedUpShipment.currentWarehouseId).toBeNull();
  });

  it('5. Origin Warehouse Staff checks in shipment with package verification', async () => {
    const verification = {
      packageVerified: true,
      actualWeightGrams: 2100,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    } as const;

    await request(server)
      .get(`/api/v1/warehouses/${destinationWarehouseId}/check-in/lookup`)
      .query({ trackingCode })
      .set('Authorization', `Bearer ${staff2Token}`)
      .expect(403);

    await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${staff2Token}`)
      .send({ trackingCode, ...verification })
      .expect(403);

    const lookupRes = await request(server)
      .get(`/api/v1/warehouses/${originWarehouseId}/check-in/lookup`)
      .query({ trackingCode })
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(bodyFrom<{ trackingCode: string }>(lookupRes).data.trackingCode).toBe(trackingCode);
    expect(JSON.stringify(lookupRes.body)).not.toMatch(
      /passwordHash|refreshTokenHash|tokenVersion/,
    );

    const checkInRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({
        trackingCode,
        ...verification,
        note: 'Kiểm tra ngoại quan tốt, cân thực tế 2.1kg',
      })
      .expect(200);

    const body = bodyFrom<CheckInResponse>(checkInRes).data;
    expect(JSON.stringify(checkInRes.body)).not.toMatch(
      /passwordHash|refreshTokenHash|tokenVersion/,
    );
    expect(body.idempotent).toBe(false);
    expect(body.shipment.status).toBe(ShipmentStatus.AT_ORIGIN_WAREHOUSE);
    expect(body.shipment.originWarehouseId).toBe(originWarehouseId);
    expect(body.shipment.currentWarehouseId).toBe(originWarehouseId);
    expect(body.shipment.destinationWarehouseId).toBeNull();

    const historyCount = await prisma.trackingEvent.count({ where: { shipmentId } });
    const auditCount = await prisma.auditLog.count({
      where: { entityType: 'SHIPMENT', entityId: shipmentId },
    });

    // Idempotent retry returns same
    const retryRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/check-in`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({ trackingCode, ...verification })
      .expect(200);
    expect(bodyFrom<CheckInResponse>(retryRes).data.idempotent).toBe(true);
    expect(JSON.stringify(retryRes.body)).not.toMatch(/passwordHash|refreshTokenHash|tokenVersion/);
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(historyCount);
    expect(
      await prisma.auditLog.count({ where: { entityType: 'SHIPMENT', entityId: shipmentId } }),
    ).toBe(auditCount);

    const inventoryRes = await request(server)
      .get(`/api/v1/warehouses/${originWarehouseId}/shipments`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(JSON.stringify(inventoryRes.body)).not.toMatch(
      /passwordHash|refreshTokenHash|tokenVersion/,
    );
    expect(
      bodyFrom<{ items: Array<{ id: string }> }>(inventoryRes).data.items.some(
        (shipment) => shipment.id === shipmentId,
      ),
    ).toBe(true);
  });

  it('6. Origin Warehouse Staff sorts, creates, then dispatches transfer to Saigon', async () => {
    const routeRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/shipments/${shipmentId}/route-destination`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({ destinationWarehouseId })
      .expect(201);
    expect(bodyFrom<ShipmentWarehouseState>(routeRes).data.destinationWarehouseId).toBe(
      destinationWarehouseId,
    );

    const clientRequestId = 'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e';
    const transferRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({
        shipmentId,
        toWarehouseId: destinationWarehouseId,
        note: 'Chuyến xe trung chuyển Bắc Nam ban đêm',
        clientRequestId,
      })
      .expect(201);

    const transfer = bodyFrom<{
      id: string;
      status: WarehouseTransferStatus;
      transferCode: string;
    }>(transferRes).data;
    expect(transfer.status).toBe(WarehouseTransferStatus.PENDING);
    expect(transfer.transferCode).toContain('TRF-');

    const pendingShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(pendingShipment.status).toBe(ShipmentStatus.AT_ORIGIN_WAREHOUSE);
    expect(pendingShipment.currentWarehouseId).toBe(originWarehouseId);

    const transferCount = await prisma.warehouseTransfer.count({ where: { shipmentId } });
    const createRetryRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({
        shipmentId,
        toWarehouseId: destinationWarehouseId,
        note: 'Chuyến xe trung chuyển Bắc Nam ban đêm',
        clientRequestId,
      })
      .expect(201);
    expect(bodyFrom<{ id: string }>(createRetryRes).data.id).toBe(transfer.id);
    expect(await prisma.warehouseTransfer.count({ where: { shipmentId } })).toBe(transferCount);

    const dispatchRes = await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transfer.id}/dispatch`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(bodyFrom<{ status: WarehouseTransferStatus }>(dispatchRes).data.status).toBe(
      WarehouseTransferStatus.IN_TRANSIT,
    );

    // Verify shipment status is IN_TRANSIT
    const trackingRes = await request(server).get(`/api/v1/tracking/${trackingCode}`).expect(200);
    const trackingTimeline = bodyFrom<TrackingTimelineResponse>(trackingRes).data.timeline;
    expect(trackingTimeline.some((event) => event.status === ShipmentStatus.IN_TRANSIT)).toBe(true);
    const inTransitShipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(inTransitShipment.status).toBe(ShipmentStatus.IN_TRANSIT);
    expect(inTransitShipment.currentWarehouseId).toBeNull();

    const dispatchedHistoryCount = await prisma.trackingEvent.count({ where: { shipmentId } });
    const dispatchAuditCount = await prisma.auditLog.count({
      where: { entityType: 'WAREHOUSE_TRANSFER', entityId: transfer.id },
    });
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transfer.id}/dispatch`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(
      dispatchedHistoryCount,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'WAREHOUSE_TRANSFER', entityId: transfer.id },
      }),
    ).toBe(dispatchAuditCount);

    // 6. Unauthorized Staff (Staff 1 in Hanoi) cannot receive transfer addressed to Saigon
    await request(server)
      .post(`/api/v1/warehouses/${originWarehouseId}/transfers/${transfer.id}/receive`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({ note: 'Nhận nhầm' })
      .expect(403);

    // 7. Destination Warehouse Staff (Staff 2 in Saigon) receives transfer
    const receiveRes = await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transfer.id}/receive`)
      .set('Authorization', `Bearer ${staff2Token}`)
      .send({
        note: 'Đã nhận đủ tại kho Sài Gòn, kiện hàng nguyên vẹn',
      })
      .expect(200);

    const receivedTransfer = bodyFrom<{ status: WarehouseTransferStatus }>(receiveRes).data;
    expect(receivedTransfer.status).toBe(WarehouseTransferStatus.COMPLETED);

    const receivedShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(receivedShipment.status).toBe(ShipmentStatus.AT_DESTINATION_WAREHOUSE);
    expect(receivedShipment.currentWarehouseId).toBe(destinationWarehouseId);

    const receivedHistoryCount = await prisma.trackingEvent.count({ where: { shipmentId } });
    const receiveAuditCount = await prisma.auditLog.count({
      where: { entityType: 'WAREHOUSE_TRANSFER', entityId: transfer.id },
    });
    await request(server)
      .post(`/api/v1/warehouses/${destinationWarehouseId}/transfers/${transfer.id}/receive`)
      .set('Authorization', `Bearer ${staff2Token}`)
      .send({ note: 'Retry receive' })
      .expect(200);
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(receivedHistoryCount);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'WAREHOUSE_TRANSFER', entityId: transfer.id },
      }),
    ).toBe(receiveAuditCount);

    // 8. Destination Warehouse Staff marks shipment ready for delivery assignment
    const readyRes = await request(server)
      .post(
        `/api/v1/warehouses/${destinationWarehouseId}/shipments/${shipmentId}/ready-for-delivery`,
      )
      .set('Authorization', `Bearer ${staff2Token}`)
      .expect(201);

    const finalShipment = bodyFrom<ShipmentWarehouseState>(readyRes).data;
    expect(finalShipment.status).toBe(ShipmentStatus.AWAITING_DELIVERY_ASSIGNMENT);
    expect(finalShipment.currentWarehouseId).toBe(destinationWarehouseId);
  });
});
