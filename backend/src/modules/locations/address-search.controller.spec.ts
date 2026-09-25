import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../../database/prisma.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
import { AddressSearchService } from './address-search.service.js';
import { ApiResponseInterceptor } from '../../common/interceptors/api-response.interceptor.js';
import { AddressesController } from '../addresses/addresses.controller.js';
import { AddressesService } from '../addresses/addresses.service.js';
import type { CreateAddressDto } from '../addresses/dto/create-address.dto.js';
import type { UpdateAddressDto } from '../addresses/dto/update-address.dto.js';

describe('address search HTTP boundary (session repository/provider mocked)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'test-only-secret-for-address-search-1234';
  const originalFetch = globalThis.fetch;
  const service = new AddressSearchService(new ConfigService({ LOCATIONIQ_API_KEY: 'test' }), {
    increment: () =>
      Promise.resolve({
        totalHits: 1,
        timeToExpire: 1,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
  });
  const search = jest.spyOn(service, 'search');
  let saved: Partial<CreateAddressDto> = {};
  const session = {
    userId: 'customer',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      tokenVersion: 0,
      mustChangePassword: false,
    },
  };
  beforeAll(async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              place_id: 'thu-duc',
              display_name: '123 Nguyễn Trãi, Thành phố Thủ Đức, Hồ Chí Minh',
              lat: '10.851',
              lon: '106.759',
              address: {
                country_code: 'vn',
                state: 'Hồ Chí Minh',
                city: 'Thành phố Thủ Đức',
                suburb: 'Bến Thành',
              },
            },
            {
              place_id: '123',
              display_name: 'Test address',
              lat: '10.7695084',
              lon: '106.6907953',
              address: { country_code: 'vn', city: 'Hồ Chí Minh', suburb: 'Bến Thành' },
            },
          ]),
        ),
      ),
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({}), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [LocationsController, AddressesController],
      providers: [
        { provide: LocationsService, useValue: {} },
        { provide: AddressSearchService, useValue: service },
        {
          provide: AddressesService,
          useValue: {
            create: (_user: string, dto: CreateAddressDto) => Promise.resolve((saved = { ...dto })),
            update: (_user: string, _id: string, dto: UpdateAddressDto) =>
              Promise.resolve((saved = { ...saved, ...dto })),
            list: () => Promise.resolve([saved]),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_ACCESS_SECRET: secret,
            JWT_ISSUER: 'test',
            JWT_AUDIENCE: 'test',
          }),
        },
        {
          provide: PrismaService,
          useValue: { authSession: { findUnique: () => Promise.resolve(session) } },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
  });
  const token = () =>
    jwt.sign(
      { sub: 'customer', sid: 'session', role: session.user.role, type: 'access', ver: 0 },
      { secret, issuer: 'test', audience: 'test', expiresIn: 60 },
    );
  it('requires authentication, validates body, restricts role and enforces endpoint rate limit', async () => {
    const http = app.getHttpServer() as Server;
    const path = '/api/v1/locations/address-search';
    const body = { street: ' 123 Nguyễn Trãi ', city: ' Hồ Chí Minh ', ward: ' Bến Thành ' };
    await request(http).post(path).send(body).expect(401);
    await request(http)
      .post(path)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...body, street: ' ' })
      .expect(400);
    session.user.role = 'DRIVER';
    await request(http).post(path).set('Authorization', `Bearer ${token()}`).send(body).expect(403);
    session.user.role = 'ADMIN';
    const response = await request(http)
      .post(path)
      .set('Authorization', `Bearer ${token()}`)
      .send(body)
      .expect(200);
    const result = (response.body as { data: { latitude: number; longitude: number }[] }).data[0];
    expect((response.body as { data: unknown[] }).data).toHaveLength(1);
    expect(typeof result.latitude).toBe('number');
    expect(typeof result.longitude).toBe('number');
    expect(result).toMatchObject({ latitude: 10.769508, longitude: 106.690795 });
    session.user.role = 'CUSTOMER';
    const address = {
      label: 'Home',
      contactName: 'Test Customer',
      phone: '0901234567',
      streetAddress: '123 Street',
      ward: 'Ben Thanh',
      district: '',
      city: 'Ho Chi Minh',
      latitude: result.latitude,
      longitude: result.longitude,
    };
    for (const method of ['post', 'patch'] as const) {
      const target = method === 'post' ? '/api/v1/addresses' : '/api/v1/addresses/test-address';
      const write = await request(http)
        [method](target)
        .set('Authorization', `Bearer ${token()}`)
        .send(address)
        .expect(method === 'post' ? 201 : 200);
      expect((write.body as { data: unknown }).data).toMatchObject({
        latitude: result.latitude,
        longitude: result.longitude,
      });
      await request(http)
        [method](target)
        .set('Authorization', `Bearer ${token()}`)
        .send({
          ...address,
          latitude: String(result.latitude),
          longitude: String(result.longitude),
        })
        .expect(400);
      // Pre-fix provider output was already numeric, but exceeded DTO precision.
      const rejected = await request(http)
        [method](target)
        .set('Authorization', `Bearer ${token()}`)
        .send({ ...address, latitude: 10.7695084, longitude: 106.6907953 })
        .expect(400);
      expect((rejected.body as { message: string[] }).message).toEqual(
        expect.arrayContaining([
          'latitude must be a number conforming to the specified constraints',
          'longitude must be a number conforming to the specified constraints',
        ]),
      );
    }
    const reload = await request(http)
      .get('/api/v1/addresses')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect((reload.body as { data: unknown[] }).data[0]).toMatchObject({
      latitude: result.latitude,
      longitude: result.longitude,
    });
    expect(search).toHaveBeenLastCalledWith({
      street: '123 Nguyễn Trãi',
      city: 'Hồ Chí Minh',
      ward: 'Bến Thành',
    });
    for (let i = 0; i < 6; i++)
      await request(http)
        .post(path)
        .set('Authorization', `Bearer ${token()}`)
        .send(body)
        .expect(200);
    await request(http).post(path).set('Authorization', `Bearer ${token()}`).send(body).expect(429);
    expect(search).toHaveBeenCalledTimes(7);
  });
});
