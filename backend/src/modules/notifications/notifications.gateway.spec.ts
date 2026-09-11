import { jest } from '@jest/globals';
import { NotificationsGateway } from './notifications.gateway.js';

function socketFixture(role = 'DISPATCHER') {
  const user = { id: 'user-1', role, status: 'ACTIVE', tokenVersion: 1, mustChangePassword: false };
  const session = {
    user,
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const findFirst = jest.fn<() => Promise<{ id: string } | null>>(() =>
    Promise.resolve({ id: 'resource' }),
  );
  const findUnique = jest.fn(() => Promise.resolve(session));
  const client = {
    data: { userId: user.id, role },
    handshake: { auth: { token: 'signed-token' }, headers: {} },
    join: jest.fn(() => Promise.resolve()),
    leave: jest.fn(() => Promise.resolve()),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  const gateway = new NotificationsGateway(
    {
      verifyAsync: jest.fn(() =>
        Promise.resolve({
          type: 'access',
          sub: user.id,
          sid: 'session-1',
          role,
          ver: 1,
          exp: Math.ceil(Date.now() / 1000) + 60,
        }),
      ),
    } as never,
    { getOrThrow: () => 'configured' } as never,
    {
      authSession: { findUnique },
      shipment: { findFirst },
      lineHaulTrip: { findFirst },
      warehouseStaffProfile: {
        findUnique: () => Promise.resolve({ warehouseId: 'warehouse', isActive: true }),
      },
      driverAssignment: { findFirst },
    } as never,
  );
  const to = jest.fn(() => ({
    fetchSockets: () => Promise.resolve([client]),
    socketsLeave: jest.fn(),
  }));
  (gateway as unknown as { server: unknown }).server = { in: to };
  return { gateway, client, session, findFirst, findUnique, to, emit: client.emit };
}

describe('NotificationsGateway driver location broadcast', () => {
  it('broadcasts operations and only the explicitly authorized shipment rooms', async () => {
    const { gateway, to, emit } = socketFixture();
    const location = {
      driverId: '22222222-2222-4222-8222-222222222222',
      latitude: 10.7769,
      longitude: 106.7009,
      updatedAt: '2026-08-21T06:00:00.000Z',
    };

    await gateway.emitDriverLocationUpdated(location, ['33333333-3333-4333-8333-333333333333']);

    expect(to).toHaveBeenCalledWith('dispatcher:operations');
    expect(to).toHaveBeenCalledWith('shipment-location:33333333-3333-4333-8333-333333333333');
    expect(to).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('driver.location.updated', location);
  });

  it('disconnects a socket when the authenticated access token expires', () => {
    jest.useFakeTimers();
    const disconnect = jest.fn();
    const gateway = new NotificationsGateway({} as never, {} as never, {} as never);
    const client = {
      id: 'socket-1',
      data: { accessTokenExpiresAt: Date.now() + 1_000 },
      disconnect,
    };

    gateway.handleConnection(client as never);
    jest.advanceTimersByTime(1_000);

    expect(disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(client as never);
    jest.useRealTimers();
  });

  it('rejects malformed shipment subscriptions before querying authorization state', async () => {
    const findFirst = jest.fn();
    const gateway = new NotificationsGateway(
      {} as never,
      {} as never,
      { shipment: { findFirst } } as never,
    );
    const client = {
      data: { userId: 'user-1', role: 'CUSTOMER' },
      join: jest.fn(),
    };

    await expect(
      gateway.subscribeShipment(client as never, { shipmentId: '../invalid' }),
    ).resolves.toEqual({
      subscribed: false,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('authorizes an in-transit line-haul room by role and warehouse scope', async () => {
    const tripId = '44444444-4444-4444-8444-444444444444';
    const { gateway, client, findFirst } = socketFixture('WAREHOUSE_STAFF');

    await expect(gateway.subscribeLineHaulTrip(client as never, { tripId })).resolves.toEqual({
      subscribed: true,
    });
    expect(client.join).toHaveBeenCalledWith(`linehaul-trip:${tripId}`);
    expect(findFirst).toHaveBeenCalled();
  });

  it('denies customer line-haul subscription without querying trip data', async () => {
    const { gateway, client, findFirst } = socketFixture('CUSTOMER');

    await expect(
      gateway.subscribeLineHaulTrip(client as never, {
        tripId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toEqual({ subscribed: false });
    expect(findFirst).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalledWith(
      'linehaul-trip:44444444-4444-4444-8444-444444444444',
    );
  });

  it('broadcasts the minimal line-haul payload only to its trip room', async () => {
    const { gateway, to, emit } = socketFixture();
    const location = {
      tripId: '44444444-4444-4444-8444-444444444444',
      latitude: 10.7769,
      longitude: 106.7009,
      capturedAt: '2026-09-05T06:00:00.000Z',
    };

    await gateway.emitLineHaulLocationUpdated(location);

    expect(to).toHaveBeenCalledWith(`linehaul-trip:${location.tripId}`);
    expect(to).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('linehaul.location.updated', location);
  });

  it('broadcasts deviation transitions and route invalidations only to the authorized trip room', async () => {
    const { gateway, to, emit } = socketFixture();
    const tripId = '44444444-4444-4444-8444-444444444444';
    const deviation = {
      tripId,
      state: 'DEVIATED' as const,
      distanceFromRouteMeters: 742,
      detectedAt: '2026-09-05T06:05:00.000Z',
    };
    const routeUpdate = {
      tripId,
      routeVersion: 2,
      calculatedAt: '2026-09-05T06:06:00.000Z',
    };

    await gateway.emitLineHaulRouteDeviationChanged(deviation);
    await gateway.emitLineHaulRouteUpdated(routeUpdate);

    expect(to).toHaveBeenNthCalledWith(1, `linehaul-trip:${tripId}`);
    expect(to).toHaveBeenNthCalledWith(2, `linehaul-trip:${tripId}`);
    expect(emit).toHaveBeenNthCalledWith(1, 'linehaul.route.deviation.changed', deviation);
    expect(emit).toHaveBeenNthCalledWith(2, 'linehaul.route.updated', routeUpdate);
  });

  it('disconnects a revoked session before publishing to an already joined room', async () => {
    const { gateway, client, session } = socketFixture();
    session.revokedAt = new Date();
    await gateway.emitShipmentUpdated('shipment-1', 'DELIVERED');
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('rechecks warehouse scope before delivering to an old trip room', async () => {
    const { gateway, client, findFirst } = socketFixture('WAREHOUSE_STAFF');
    findFirst.mockResolvedValue(null);
    await gateway.emitLineHaulRouteUpdated({
      tripId: 'trip-1',
      routeVersion: 2,
      calculatedAt: new Date().toISOString(),
    });
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.leave).toHaveBeenCalledWith('linehaul-trip:trip-1');
  });

  it('rejects further subscriptions from a suspended user', async () => {
    const { gateway, client, session } = socketFixture();
    session.user.status = 'SUSPENDED';
    await expect(
      gateway.subscribeShipment(client as never, {
        shipmentId: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toEqual({ subscribed: false });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('fails closed when the authorization database cannot be read', async () => {
    const { gateway, client, findUnique } = socketFixture();
    findUnique.mockRejectedValue(new Error('database unavailable'));
    await gateway.emitShipmentUpdated('shipment-1', 'DELIVERED');
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
