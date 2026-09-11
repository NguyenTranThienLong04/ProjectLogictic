import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Notification } from '../../generated/prisma/client.js';
import {
  DriverCapability,
  DriverStatus,
  LineHaulTripStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service.js';
import type { AccessTokenPayload } from '../auth/auth.types.js';
import { activeAssignmentStatuses } from '../assignments/assignment.policy.js';

interface SocketData {
  userId?: string;
  role?: UserRole;
  driverId?: string;
  accessTokenExpiresAt?: number;
}

@WebSocketGateway({ namespace: '/operations' })
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly expirationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    server.use((client, next) => {
      void this.authenticate(client)
        .then(() => next())
        .catch(() => next(new Error('Unauthorized socket')));
    });
  }

  handleConnection(client: Socket): void {
    const expiresAt = (client.data as SocketData).accessTokenExpiresAt;
    const delay = expiresAt ? expiresAt - Date.now() : 0;
    if (delay <= 0) {
      client.disconnect(true);
      return;
    }

    const timer = setTimeout(() => {
      this.expirationTimers.delete(client.id);
      client.disconnect(true);
    }, delay);
    timer.unref();
    this.expirationTimers.set(client.id, timer);
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expirationTimers.get(client.id);
    if (timer) clearTimeout(timer);
    this.expirationTimers.delete(client.id);
  }

  private async authenticate(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
      audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
      algorithms: ['HS256'],
    });
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            tokenVersion: true,
            mustChangePassword: true,
            driverProfile: { select: { id: true } },
          },
        },
      },
    });
    const user = session?.user;
    if (
      payload.type !== 'access' ||
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !user ||
      user.id !== payload.sub ||
      user.role !== payload.role ||
      user.status !== UserStatus.ACTIVE ||
      user.tokenVersion !== payload.ver ||
      user.mustChangePassword
    ) {
      throw new Error('Unauthorized socket');
    }
    if (!payload.exp) throw new Error('Unauthorized socket');

    const data = client.data as SocketData;
    data.userId = user.id;
    data.role = user.role;
    data.driverId = user.driverProfile?.id;
    data.accessTokenExpiresAt = payload.exp * 1_000;
    await client.join(`user:${user.id}`);
    if (data.driverId) await client.join(`driver:${data.driverId}`);
    if (data.role === UserRole.DISPATCHER || data.role === UserRole.ADMIN)
      await client.join('dispatcher:operations');
  }

  @SubscribeMessage('shipment.subscribe')
  async subscribeShipment(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ subscribed: boolean }> {
    const data = client.data as SocketData;
    const shipmentId = this.validShipmentId(payload);
    if (!data.userId || !shipmentId) return { subscribed: false };
    if (!(await this.revalidate(client))) return { subscribed: false };
    const canAccess = await this.canAccessShipment(
      data.userId,
      data.role,
      data.driverId,
      shipmentId,
    );
    if (!canAccess) return { subscribed: false };
    await client.join(`shipment:${shipmentId}`);
    if (data.role === UserRole.CUSTOMER) {
      await client.join(`shipment-location:${shipmentId}`);
    }
    return { subscribed: true };
  }

  @SubscribeMessage('linehaul.trip.subscribe')
  async subscribeLineHaulTrip(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ subscribed: boolean }> {
    const data = client.data as SocketData;
    const tripId = this.validEntityId(payload, 'tripId');
    if (!data.userId || !tripId) return { subscribed: false };
    if (!(await this.revalidate(client))) return { subscribed: false };
    if (!(await this.canAccessLineHaulTrip(data.userId, data.role, data.driverId, tripId))) {
      return { subscribed: false };
    }
    await client.join(this.lineHaulRoom(tripId));
    return { subscribed: true };
  }

  private validShipmentId(payload: unknown): string | undefined {
    return this.validEntityId(payload, 'shipmentId');
  }

  private validEntityId(payload: unknown, property: 'shipmentId' | 'tripId'): string | undefined {
    if (!payload || typeof payload !== 'object' || !(property in payload)) return undefined;
    const shipmentId = (payload as Record<string, unknown>)[property];
    if (typeof shipmentId !== 'string') return undefined;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      shipmentId,
    )
      ? shipmentId
      : undefined;
  }

  async emitNotification(notification: Notification): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(`user:${notification.userId}`, 'notification.created', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
    });
  }

  async emitAssignmentCreated(input: {
    driverId: string;
    shipmentId: string;
    assignmentId: string;
  }): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(`driver:${input.driverId}`, 'assignment.created', input);
    await this.emitToRoom(`shipment:${input.shipmentId}`, 'shipment.updated', {
      shipmentId: input.shipmentId,
      status: 'PICKUP_ASSIGNED',
    });
  }

  async emitShipmentUpdated(shipmentId: string, status: string): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(`shipment:${shipmentId}`, 'shipment.updated', { shipmentId, status });
  }

  async emitDriverLocationUpdated(
    location: { driverId: string; latitude: number; longitude: number; updatedAt: string },
    shipmentIds: string[],
  ): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom('dispatcher:operations', 'driver.location.updated', location);
    for (const shipmentId of shipmentIds) {
      await this.emitToRoom(`shipment-location:${shipmentId}`, 'driver.location.updated', location);
    }
  }

  async emitLineHaulLocationUpdated(location: {
    tripId: string;
    latitude: number;
    longitude: number;
    capturedAt: string;
  }): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(
      this.lineHaulRoom(location.tripId),
      'linehaul.location.updated',
      location,
    );
  }

  async emitLineHaulRouteDeviationChanged(payload: {
    tripId: string;
    state: 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN';
    distanceFromRouteMeters: number | null;
    detectedAt: string;
  }): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(
      this.lineHaulRoom(payload.tripId),
      'linehaul.route.deviation.changed',
      payload,
    );
  }

  async emitLineHaulRouteUpdated(payload: {
    tripId: string;
    routeVersion: number;
    calculatedAt: string;
  }): Promise<void> {
    if (!this.server) return;
    await this.emitToRoom(this.lineHaulRoom(payload.tripId), 'linehaul.route.updated', payload);
  }

  async emitLineHaulTripEnded(tripId: string, arrivedAt: string): Promise<void> {
    if (!this.server) return;
    const room = this.lineHaulRoom(tripId);
    await this.emitToRoom(room, 'linehaul.trip.ended', { tripId, status: 'ARRIVED', arrivedAt });
    this.server.in(room).socketsLeave(room);
  }

  private extractToken(client: Socket): string {
    const auth = client.handshake.auth as Record<string, unknown>;
    const authToken = auth.token;
    if (typeof authToken === 'string' && authToken) return authToken;
    const [scheme, headerToken] = client.handshake.headers.authorization?.split(' ') ?? [];
    if (scheme === 'Bearer' && headerToken) return headerToken;
    throw new Error('Missing socket token');
  }

  private async revalidate(client: Socket): Promise<boolean> {
    try {
      await this.authenticate(client);
      return true;
    } catch {
      client.disconnect(true);
      return false;
    }
  }

  private async emitToRoom(room: string, event: string, payload: unknown): Promise<void> {
    try {
      const clients = await this.server.in(room).fetchSockets();
      await Promise.all(
        clients.map(async (remote) => {
          const client = remote as unknown as Socket;
          if (!(await this.revalidate(client))) return;
          const data = client.data as SocketData;
          let allowed: boolean;
          if (room.startsWith('linehaul-trip:')) {
            allowed = await this.canAccessLineHaulTrip(
              data.userId!,
              data.role,
              data.driverId,
              room.slice('linehaul-trip:'.length),
              event === 'linehaul.trip.ended',
            );
          } else if (room.startsWith('shipment-location:')) {
            allowed =
              data.role === UserRole.CUSTOMER &&
              Boolean(
                await this.prisma.shipment.findFirst({
                  where: {
                    id: room.slice('shipment-location:'.length),
                    customerId: data.userId,
                    status: 'OUT_FOR_DELIVERY',
                  },
                  select: { id: true },
                }),
              );
          } else if (room.startsWith('shipment:')) {
            allowed = await this.canAccessShipment(
              data.userId!,
              data.role,
              data.driverId,
              room.slice('shipment:'.length),
            );
          } else if (room === 'dispatcher:operations') {
            allowed = data.role === UserRole.ADMIN || data.role === UserRole.DISPATCHER;
          } else {
            allowed = room === `user:${data.userId}` || room === `driver:${data.driverId}`;
          }
          if (allowed) client.emit(event, payload);
          else await client.leave(room);
        }),
      );
    } catch {
      // Realtime is disposable: fail closed without leaking errors or failing committed commands.
      this.logger.warn('Socket delivery skipped because authorization could not be verified');
    }
  }

  private async canAccessShipment(
    userId: string,
    role: UserRole | undefined,
    driverId: string | undefined,
    shipmentId: string,
  ): Promise<boolean> {
    if (role === UserRole.ADMIN || role === UserRole.DISPATCHER) return true;
    if (role === UserRole.CUSTOMER) {
      return Boolean(
        await this.prisma.shipment.findFirst({
          where: { id: shipmentId, customerId: userId },
          select: { id: true },
        }),
      );
    }
    if (role === UserRole.DRIVER && driverId) {
      return Boolean(
        await this.prisma.driverAssignment.findFirst({
          where: { shipmentId, driverId, status: { in: activeAssignmentStatuses } },
          select: { id: true },
        }),
      );
    }
    this.logger.warn(`Denied shipment room subscription for user ${userId}`);
    return false;
  }

  private async canAccessLineHaulTrip(
    userId: string,
    role: UserRole | undefined,
    driverId: string | undefined,
    tripId: string,
    allowArrived = false,
  ): Promise<boolean> {
    const status = allowArrived
      ? { in: [LineHaulTripStatus.IN_TRANSIT, LineHaulTripStatus.ARRIVED] }
      : LineHaulTripStatus.IN_TRANSIT;
    if (role === UserRole.CUSTOMER || !role) return false;
    if (role === UserRole.ADMIN || role === UserRole.DISPATCHER) {
      return Boolean(
        await this.prisma.lineHaulTrip.findFirst({
          where: { id: tripId, status },
          select: { id: true },
        }),
      );
    }
    if (role === UserRole.DRIVER && driverId) {
      return Boolean(
        await this.prisma.lineHaulTrip.findFirst({
          where: {
            id: tripId,
            driverId,
            status,
            driver: {
              status: { not: DriverStatus.SUSPENDED },
              capabilities: { has: DriverCapability.LINE_HAUL },
            },
          },
          select: { id: true },
        }),
      );
    }
    if (role === UserRole.WAREHOUSE_STAFF) {
      const profile = await this.prisma.warehouseStaffProfile.findUnique({
        where: { userId },
        select: { warehouseId: true, isActive: true },
      });
      if (!profile?.isActive) return false;
      return Boolean(
        await this.prisma.lineHaulTrip.findFirst({
          where: {
            id: tripId,
            status,
            OR: [
              { originWarehouseId: profile.warehouseId },
              { destinationWarehouseId: profile.warehouseId },
            ],
          },
          select: { id: true },
        }),
      );
    }
    return false;
  }

  private lineHaulRoom(tripId: string): string {
    return `linehaul-trip:${tripId}`;
  }
}
