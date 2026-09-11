import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriverStatus, ShipmentStatus, UserRole } from '../src/generated/prisma/client.js';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service.js';
import { RedisService } from '../src/redis/redis.service.js';

jest.setTimeout(120_000);

const mockLocationValues = new Map<string, string>();
const mockRedisClient = {
  status: 'ready',
  get: jest.fn((key: string) => Promise.resolve(mockLocationValues.get(key) ?? null)),
  mget: jest.fn((keys: string[]) =>
    Promise.resolve(keys.map((key) => mockLocationValues.get(key) ?? null)),
  ),
  set: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
};
const mockRedisService = {
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
  getClient: jest.fn().mockReturnValue(mockRedisClient),
};

interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

interface AuthPayload {
  accessToken: string;
  user: {
    id: string;
    role: UserRole;
  };
}

interface DriverPayload {
  id: string;
  userId: string;
  employeeCode: string;
  status: DriverStatus;
  isOnline: boolean;
  isAvailable: boolean;
}

interface ShipmentPayload {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
}

interface AssignmentPayload {
  id: string;
  shipmentId: string;
  driverId: string;
  status: string;
  proof?: {
    id: string;
    note?: string;
  };
}

function bodyFrom<T>(response: Response): ApiEnvelope<T> {
  const body: unknown = response.body;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error('API response envelope is missing');
  }
  return body as ApiEnvelope<T>;
}

describe('Phase 3 Dispatcher & Pickup Driver flow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let hasher: PasswordHasherService;
  let operatingWarehouseId = '';
  const runId = randomUUID().replaceAll('-', '');

  const adminEmail = `admin-${runId}@example.com`;
  const dispatcherEmail = `dispatcher-${runId}@example.com`;
  const driver1Email = `driver1-${runId}@example.com`;
  const driver2Email = `driver2-${runId}@example.com`;
  const customerEmail = `customer-${runId}@example.com`;
  const emails = [adminEmail, dispatcherEmail, driver1Email, driver2Email, customerEmail];

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
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    const shipments = await prisma.shipment.findMany({
      where: { customerId: { in: userIds } },
      select: { id: true },
    });
    const shipmentIds = shipments.map((s) => s.id);

    if (shipmentIds.length) {
      await prisma.shipmentProof.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.driverAssignment.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.auditLog.deleteMany({
        where: { entityType: 'Shipment', entityId: { in: shipmentIds } },
      });
      await prisma.shippingFeeTransaction.deleteMany({
        where: { shipmentId: { in: shipmentIds } },
      });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }

    if (userIds.length) {
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.customerAddress.deleteMany({ where: { customerId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (operatingWarehouseId) {
      await prisma.warehouse.delete({ where: { id: operatingWarehouseId } });
    }

    await app.close();
  });

  it('runs complete dispatcher confirm -> assign -> reassign -> driver reject -> assign -> accept -> pickup flow', async () => {
    // 1. Seed users (ADMIN, DISPATCHER, DRIVERS)
    const passwordHash = await hasher.hash('Password123!');
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: 'Admin User',
        passwordHash,
        role: UserRole.ADMIN,
        mustChangePassword: false,
      },
    });

    await prisma.user.create({
      data: {
        email: dispatcherEmail,
        fullName: 'Dispatcher User',
        passwordHash,
        role: UserRole.DISPATCHER,
        mustChangePassword: false,
      },
    });

    const driver1User = await prisma.user.create({
      data: {
        email: driver1Email,
        fullName: 'Driver One User',
        passwordHash,
        role: UserRole.DRIVER,
        mustChangePassword: false,
      },
    });

    const driver2User = await prisma.user.create({
      data: {
        email: driver2Email,
        fullName: 'Driver Two User',
        passwordHash,
        role: UserRole.DRIVER,
        mustChangePassword: false,
      },
    });

    // 2. Customer registers
    const customerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: customerEmail,
        fullName: 'Customer User',
        phone: '0901112223',
        password: 'Password123!',
      })
      .expect(201);
    const customerToken = bodyFrom<AuthPayload>(customerRes).data.accessToken;

    // Login tokens
    const adminLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password123!' })
      .expect(200);
    const adminToken = bodyFrom<AuthPayload>(adminLoginRes).data.accessToken;

    const dispatcherLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: dispatcherEmail, password: 'Password123!' })
      .expect(200);
    const dispatcherToken = bodyFrom<AuthPayload>(dispatcherLoginRes).data.accessToken;

    const driver1LoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: driver1Email, password: 'Password123!' })
      .expect(200);
    const driver1Token = bodyFrom<AuthPayload>(driver1LoginRes).data.accessToken;

    const driver2LoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: driver2Email, password: 'Password123!' })
      .expect(200);
    const driver2Token = bodyFrom<AuthPayload>(driver2LoginRes).data.accessToken;

    const operatingWarehouse = await prisma.warehouse.create({
      data: {
        code: `P3-${runId.slice(0, 12).toUpperCase()}`,
        name: 'Phase 3 Operating Hub',
        address: '1 Nguyễn Huệ',
        city: 'Hồ Chí Minh',
        latitude: 10.7769,
        longitude: 106.7009,
      },
    });
    operatingWarehouseId = operatingWarehouse.id;

    // 3. Admin creates driver profiles
    const driver1ProfileRes = await request(server)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: driver1User.id,
        operatingWarehouseId,
        employeeCode: `D1-${runId.slice(0, 12)}`,
        vehicleType: 'Xe máy',
        vehiclePlate: '29A1-11111',
      })
      .expect(201);
    const driver1Profile = bodyFrom<DriverPayload>(driver1ProfileRes).data;

    const driver2ProfileRes = await request(server)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: driver2User.id,
        operatingWarehouseId,
        employeeCode: `D2-${runId.slice(0, 12)}`,
        vehicleType: 'Xe tải 1 tấn',
        vehiclePlate: '29C1-22222',
      })
      .expect(201);
    const driver2Profile = bodyFrom<DriverPayload>(driver2ProfileRes).data;
    const updatedAt = new Date().toISOString();
    mockLocationValues.set(
      `driver:location:${driver1Profile.id}`,
      JSON.stringify({
        driverId: driver1Profile.id,
        latitude: 10.777,
        longitude: 106.701,
        updatedAt,
      }),
    );
    mockLocationValues.set(
      `driver:location:${driver2Profile.id}`,
      JSON.stringify({
        driverId: driver2Profile.id,
        latitude: 10.78,
        longitude: 106.705,
        updatedAt,
      }),
    );

    // 4. Drivers set availability online
    await request(server)
      .patch('/api/v1/drivers/me/availability')
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ isOnline: true })
      .expect(200);

    await request(server)
      .patch('/api/v1/drivers/me/availability')
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({ isOnline: true })
      .expect(200);

    // 5. Customer creates address and shipment
    const addressRes = await request(server)
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        label: 'Kho hàng',
        contactName: 'Customer Sender',
        phone: '0901112223',
        streetAddress: '100 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        latitude: 10.7769,
        longitude: 106.7009,
      })
      .expect(201);
    const addressId = bodyFrom<{ id: string }>(addressRes).data.id;

    const shipmentRes = await request(server)
      .post('/api/v1/shipments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        clientRequestId: crypto.randomUUID(),
        pickupAddressId: addressId,
        deliveryAddress: {
          contactName: 'Receiver Phase 3',
          phone: '0988776655',
          streetAddress: '200 Hai Bà Trưng',
          ward: 'Tân Định',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        },
        package: {
          description: 'Hàng điện tử Phase 3',
          packageType: 'ELECTRONICS',
          weightGrams: 500,
          lengthCm: 20,
          widthCm: 15,
          heightCm: 10,
        },
        codAmount: 0,
        shippingFeePayer: 'SENDER',
      })
      .expect(201);
    const shipment = bodyFrom<ShipmentPayload>(shipmentRes).data;
    expect(shipment.status).toBe(ShipmentStatus.PENDING);

    // 6. Dispatcher confirms shipment -> AWAITING_PICKUP_ASSIGNMENT
    const confirmRes = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipment.id}/confirm`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .expect(200);
    const confirmedShipment = bodyFrom<ShipmentPayload>(confirmRes).data;
    expect(confirmedShipment.status).toBe(ShipmentStatus.AWAITING_PICKUP_ASSIGNMENT);

    for (const profile of [driver1Profile, driver2Profile]) {
      const stored = JSON.parse(
        mockLocationValues.get(`driver:location:${profile.id}`) ?? '{}',
      ) as Record<string, unknown>;
      mockLocationValues.set(
        `driver:location:${profile.id}`,
        JSON.stringify({ ...stored, updatedAt: new Date().toISOString() }),
      );
    }

    // 7. Dispatcher assigns driver1 -> PICKUP_ASSIGNED
    const assignClientReqId = crypto.randomUUID();
    const assignRes = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipment.id}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        driverId: driver1Profile.id,
        clientRequestId: assignClientReqId,
      })
      .expect(201);
    const assignment1 = bodyFrom<AssignmentPayload>(assignRes).data;
    expect(assignment1.status).toBe('PENDING');

    // 8. Dispatcher reassigns to driver2 while active -> assignment1 CANCELLED, assignment2 created
    const reassignClientReqId = crypto.randomUUID();
    const reassignRes = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipment.id}/pickup-reassignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        driverId: driver2Profile.id,
        reason: 'Thay đổi lộ trình phù hợp hơn',
        clientRequestId: reassignClientReqId,
      })
      .expect(201);
    const assignment2 = bodyFrom<AssignmentPayload>(reassignRes).data;
    expect(assignment2.status).toBe('PENDING');

    // 9. Driver 2 rejects assignment -> returns to AWAITING_PICKUP_ASSIGNMENT, driver2 restored to AVAILABLE
    const rejectRes = await request(server)
      .post(`/api/v1/driver/assignments/${assignment2.id}/reject`)
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({ reason: 'Xe bị sự cố thủng lốp trên đường' })
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(rejectRes).data.status).toBe('REJECTED');

    // 10. Dispatcher assigns driver1 -> PICKUP_ASSIGNED
    const finalAssignReqId = crypto.randomUUID();
    const finalAssignRes = await request(server)
      .post(`/api/v1/dispatcher/shipments/${shipment.id}/pickup-assignments`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        driverId: driver1Profile.id,
        clientRequestId: finalAssignReqId,
      })
      .expect(201);
    const finalAssignment = bodyFrom<AssignmentPayload>(finalAssignRes).data;
    expect(finalAssignment.status).toBe('PENDING');

    // 11. Driver 1 accepts assignment -> ACCEPTED, shipment PICKUP_IN_PROGRESS
    const acceptRes = await request(server)
      .post(`/api/v1/driver/assignments/${finalAssignment.id}/accept`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(acceptRes).data.status).toBe('ACCEPTED');

    // 12. Driver 1 completes pickup -> COMPLETED, shipment PICKED_UP, proof created
    const pickupRes = await request(server)
      .post(`/api/v1/driver/assignments/${finalAssignment.id}/pickup`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({
        note: 'Đã nhận nguyên seal kiện hàng',
        shippingFeeAmount: (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))
          .totalFee,
      })
      .expect(200);
    const completedAssignment = bodyFrom<AssignmentPayload>(pickupRes).data;
    expect(completedAssignment.status).toBe('COMPLETED');
    expect(completedAssignment.proof?.note).toBe('Đã nhận nguyên seal kiện hàng');

    // 13. Idempotency test: retry pickup returns same proof
    const retryPickupRes = await request(server)
      .post(`/api/v1/driver/assignments/${finalAssignment.id}/pickup`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({
        note: 'Thử lại',
        shippingFeeAmount: (await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } }))
          .totalFee,
      })
      .expect(200);
    expect(bodyFrom<AssignmentPayload>(retryPickupRes).data.proof?.id).toBe(
      completedAssignment.proof?.id,
    );
  });
});
