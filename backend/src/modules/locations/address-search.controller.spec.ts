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

describe('address search HTTP boundary (session repository/provider mocked)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'test-only-secret-for-address-search-1234';
  const search = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
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
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({}), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [LocationsController],
      providers: [
        { provide: LocationsService, useValue: {} },
        { provide: AddressSearchService, useValue: { search } },
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
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
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
    const body = { street: ' 123 Nguyễn Trãi ', city: ' Hồ Chí Minh ' };
    await request(http).post(path).send(body).expect(401);
    await request(http)
      .post(path)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...body, street: ' ' })
      .expect(400);
    session.user.role = 'DRIVER';
    await request(http).post(path).set('Authorization', `Bearer ${token()}`).send(body).expect(403);
    session.user.role = 'CUSTOMER';
    await request(http).post(path).set('Authorization', `Bearer ${token()}`).send(body).expect(200);
    expect(search).toHaveBeenLastCalledWith({ street: '123 Nguyễn Trãi', city: 'Hồ Chí Minh' });
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
