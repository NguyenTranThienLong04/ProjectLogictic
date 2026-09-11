import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DriverCapability,
  DriverAssignmentStatus,
  DriverAssignmentType,
  DriverStatus,
  LineHaulTripStatus,
  Prisma,
  ShipmentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { redactSensitiveText } from '../../common/logging/structured-log.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { activeAssignmentStatuses } from '../assignments/assignment.policy.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import {
  RouteDeviationService,
  type RouteDeviationSnapshot,
} from '../routing/route-deviation.service.js';
import { RouteMetricsService, type RouteMetric } from '../routing/route-metrics.service.js';
import type { RouteGeometry } from '../routing/route-provider.js';
import type { UpdateDriverLocationDto } from './dto/update-driver-location.dto.js';

export const LOCATION_TTL_SECONDS = 20;
export const LOCATION_TTL_MILLISECONDS = LOCATION_TTL_SECONDS * 1_000;
const ACTIVE_LINE_HAUL_CONTEXT_STATUSES = [
  LineHaulTripStatus.PLANNED,
  LineHaulTripStatus.READY,
  LineHaulTripStatus.IN_TRANSIT,
];

const lineHaulMapSelect = {
  id: true,
  tripCode: true,
  status: true,
  driverId: true,
  departedAt: true,
  originWarehouseId: true,
  destinationWarehouseId: true,
  originWarehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
  destinationWarehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
  driver: {
    select: {
      id: true,
      employeeCode: true,
      user: { select: { fullName: true } },
    },
  },
  vehicle: {
    select: {
      id: true,
      vehicleCode: true,
      licensePlate: true,
      vehicleType: true,
    },
  },
  currentRoute: {
    select: {
      version: true,
      type: true,
      distanceMeters: true,
      durationSeconds: true,
      geometry: true,
      calculatedAt: true,
    },
  },
} satisfies Prisma.LineHaulTripSelect;

type LineHaulMapRecord = Prisma.LineHaulTripGetPayload<{ select: typeof lineHaulMapSelect }>;

export interface DriverLocationResponse {
  driverId: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

export interface OperationalDriverLocationResponse extends DriverLocationResponse {
  fullName: string;
  employeeCode: string;
  vehiclePlate: string;
}

export interface LineHaulLocationResponse {
  tripId: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
}

interface StoredLineHaulLocation extends LineHaulLocationResponse {
  driverId: string;
}

export type LineHaulLocationState = 'CURRENT' | 'MISSING' | 'STALE' | 'UNAVAILABLE' | 'DISABLED';

interface LineHaulLocationRead {
  state: Exclude<LineHaulLocationState, 'DISABLED'>;
  location: LineHaulLocationResponse | null;
  capturedAt: string | null;
}

export interface LineHaulTripLocationResponse {
  tripId: string;
  tripCode: string;
  status: LineHaulTripStatus;
  departedAt: string | null;
  locationState: LineHaulLocationState;
  location: LineHaulLocationResponse | null;
  lastCapturedAt: string | null;
  route: {
    version: number;
    type: 'PLANNED' | 'REROUTE';
    distanceMeters: number;
    durationSeconds: number | null;
    geometry: RouteGeometry | null;
    calculatedAt: string;
  } | null;
  remainingRoute: {
    distanceMeters: number;
    durationSeconds: number | null;
    mode: 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';
    calculatedAt: string;
  } | null;
  deviation: RouteDeviationSnapshot;
  driver: { id: string; fullName: string; employeeCode: string };
  vehicle: { id: string; vehicleCode: string; licensePlate: string; vehicleType: string };
  origin: {
    id: string;
    code: string;
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  };
  destination: {
    id: string;
    code: string;
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  };
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsGateway,
    @Optional() private readonly deviation?: RouteDeviationService,
    @Optional() private readonly routes?: RouteMetricsService,
  ) {}

  async updateMine(
    actor: AuthenticatedUser,
    dto: UpdateDriverLocationDto,
  ): Promise<DriverLocationResponse> {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      include: { user: { select: { status: true } } },
    });
    if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    if (driver.status === DriverStatus.SUSPENDED || driver.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'DRIVER_SUSPENDED',
        message: 'A suspended or inactive driver cannot update location',
      });
    }

    const location: DriverLocationResponse = {
      driverId: driver.id,
      latitude: dto.latitude,
      longitude: dto.longitude,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.redis
        .getClient()
        .set(this.key(driver.id), JSON.stringify(location), 'EX', LOCATION_TTL_SECONDS);
    } catch (error) {
      throw new ServiceUnavailableException(
        {
          code: 'LOCATION_STORE_UNAVAILABLE',
          message: 'Current location storage is temporarily unavailable',
        },
        { cause: error },
      );
    }

    const deliveryAssignments = await this.prisma.driverAssignment.findMany({
      where: {
        driverId: driver.id,
        type: DriverAssignmentType.DELIVERY,
        status: { in: activeAssignmentStatuses },
        shipment: { status: ShipmentStatus.OUT_FOR_DELIVERY },
      },
      select: { shipmentId: true },
    });
    await this.notifications.emitDriverLocationUpdated(
      location,
      deliveryAssignments.map((assignment) => assignment.shipmentId),
    );
    return location;
  }

  async updateMyLineHaulTrip(
    actor: AuthenticatedUser,
    tripId: string,
    dto: UpdateDriverLocationDto,
  ): Promise<LineHaulLocationResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "LineHaulTrip" WHERE "id" = ${tripId}::uuid FOR UPDATE
      `;
      const [trip, driver] = await Promise.all([
        transaction.lineHaulTrip.findUnique({
          where: { id: tripId },
          select: {
            id: true,
            driverId: true,
            status: true,
            currentRoute: { select: { version: true, geometry: true } },
          },
        }),
        transaction.driverProfile.findUnique({
          where: { userId: actor.id },
          select: {
            id: true,
            status: true,
            capabilities: true,
            user: { select: { role: true, status: true } },
          },
        }),
      ]);
      if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
      if (
        driver.user.role !== UserRole.DRIVER ||
        driver.user.status !== UserStatus.ACTIVE ||
        driver.status === DriverStatus.SUSPENDED
      ) {
        throw new ForbiddenException({
          code: 'LINE_HAUL_GPS_DRIVER_INACTIVE',
          message: 'An active, non-suspended driver profile is required',
        });
      }
      if (!driver.capabilities.includes(DriverCapability.LINE_HAUL)) {
        throw new ForbiddenException({
          code: 'LINE_HAUL_GPS_CAPABILITY_REQUIRED',
          message: 'The LINE_HAUL capability is required to update this trip location',
        });
      }
      if (!trip) {
        throw this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
      }
      if (trip.driverId !== driver.id) {
        throw new ForbiddenException({
          code: 'LINE_HAUL_GPS_OWNERSHIP_FORBIDDEN',
          message: 'Only the assigned line-haul driver can update this trip location',
        });
      }
      if (trip.status !== LineHaulTripStatus.IN_TRANSIT) {
        throw new ForbiddenException({
          code: 'LINE_HAUL_GPS_NOT_IN_TRANSIT',
          message: 'Line-haul GPS is accepted only while the trip is in transit',
        });
      }

      const stored: StoredLineHaulLocation = {
        tripId,
        driverId: driver.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        capturedAt: new Date().toISOString(),
      };
      try {
        await this.redis
          .getClient()
          .set(this.lineHaulKey(tripId), JSON.stringify(stored), 'EX', LOCATION_TTL_SECONDS);
      } catch (error) {
        throw new ServiceUnavailableException(
          {
            code: 'LOCATION_STORE_UNAVAILABLE',
            message: 'Current location storage is temporarily unavailable',
          },
          { cause: error },
        );
      }

      const location = this.publicLineHaulLocation(stored);
      const geometry = this.routeGeometry(trip.currentRoute?.geometry);
      if (this.deviation && trip.currentRoute && geometry) {
        await this.deviation.evaluate({
          tripId,
          routeVersion: trip.currentRoute.version,
          geometry,
          location: { latitude: dto.latitude, longitude: dto.longitude },
          capturedAt: stored.capturedAt,
        });
      }
      // The trip row lock serializes this emit before a concurrent arrival can commit.
      await this.notifications.emitLineHaulLocationUpdated(location);
      return location;
    });
  }

  async getMyActiveLineHaulTrip(userId: string): Promise<LineHaulTripLocationResponse | null> {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    const trip = await this.prisma.lineHaulTrip.findFirst({
      where: { driverId: driver.id, status: { in: ACTIVE_LINE_HAUL_CONTEXT_STATUSES } },
      select: lineHaulMapSelect,
      orderBy: { createdAt: 'desc' },
    });
    return trip ? this.resolveLineHaulTripLocation(trip) : null;
  }

  async getLineHaulTripLocation(
    actor: AuthenticatedUser,
    tripId: string,
  ): Promise<LineHaulTripLocationResponse> {
    const trip = await this.prisma.lineHaulTrip.findUnique({
      where: { id: tripId },
      select: lineHaulMapSelect,
    });
    if (!trip) throw this.notFound('LINE_HAUL_TRIP_NOT_FOUND', 'Line-haul trip was not found');
    await this.assertLineHaulReadAccess(actor, trip);
    return this.resolveLineHaulTripLocation(trip);
  }

  async listActiveLineHaulLocations(
    actor: AuthenticatedUser,
  ): Promise<LineHaulTripLocationResponse[]> {
    const warehouseId = await this.resolveWarehouseScope(actor);
    const trips = await this.prisma.lineHaulTrip.findMany({
      where: {
        status: LineHaulTripStatus.IN_TRANSIT,
        ...(warehouseId
          ? {
              OR: [{ originWarehouseId: warehouseId }, { destinationWarehouseId: warehouseId }],
            }
          : {}),
      },
      select: lineHaulMapSelect,
      orderBy: { departedAt: 'asc' },
    });
    const reads = await this.readLineHaulMany(trips);
    const remaining = await this.remainingRoutes(trips, reads);
    return Promise.all(
      trips.map((trip, index) =>
        this.toLineHaulTripLocation(trip, reads[index], undefined, remaining.get(trip.id) ?? null),
      ),
    );
  }

  async endLineHaulTripTracking(tripId: string, arrivedAt: Date): Promise<void> {
    try {
      await this.redis.getClient().del(this.lineHaulKey(tripId));
    } catch (error) {
      this.logger.warn(
        `Line-haul location cleanup failed for ${this.lineHaulKey(tripId)}: ${this.errorMessage(error)}`,
      );
    }
    await this.notifications.emitLineHaulTripEnded(tripId, arrivedAt.toISOString());
  }

  async getMine(userId: string): Promise<DriverLocationResponse | null> {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw this.notFound('DRIVER_NOT_FOUND', 'Driver profile was not found');
    return this.read(driver.id);
  }

  async getCustomerShipmentLocation(
    customerId: string,
    shipmentId: string,
  ): Promise<DriverLocationResponse | null> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, customerId, status: ShipmentStatus.OUT_FOR_DELIVERY },
      select: { id: true },
    });
    if (!shipment) {
      throw this.notFound('SHIPMENT_LOCATION_NOT_AVAILABLE', 'Shipment location is not available');
    }
    const assignment = await this.prisma.driverAssignment.findFirst({
      where: {
        shipmentId,
        type: DriverAssignmentType.DELIVERY,
        status: DriverAssignmentStatus.ACCEPTED,
      },
      select: { driverId: true },
    });
    return assignment ? this.read(assignment.driverId) : null;
  }

  async listOperationalLocations(): Promise<OperationalDriverLocationResponse[]> {
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        status: { not: DriverStatus.SUSPENDED },
        user: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
      },
      select: {
        id: true,
        employeeCode: true,
        vehiclePlate: true,
        user: { select: { fullName: true } },
      },
    });
    const values = await this.readMany(drivers.map((driver) => driver.id));
    return drivers.flatMap((driver, index) => {
      const location = this.parse(values[index]);
      return location
        ? [
            {
              ...location,
              fullName: driver.user.fullName,
              employeeCode: driver.employeeCode,
              vehiclePlate: driver.vehiclePlate,
            },
          ]
        : [];
    });
  }

  getCurrentDriverLocation(driverId: string): Promise<DriverLocationResponse | null> {
    return this.read(driverId);
  }

  async getCurrentDriverLocations(
    driverIds: string[],
  ): Promise<Map<string, DriverLocationResponse>> {
    const values = await this.readMany(driverIds);
    const locations = new Map<string, DriverLocationResponse>();
    driverIds.forEach((driverId, index) => {
      const location = this.parse(values[index]);
      if (location) locations.set(driverId, location);
    });
    return locations;
  }

  private async read(driverId: string): Promise<DriverLocationResponse | null> {
    const key = this.key(driverId);
    try {
      return this.parse(await this.redis.getClient().get(key));
    } catch (error) {
      this.logger.warn(`Current location read failed for ${key}: ${this.errorMessage(error)}`);
      return null;
    }
  }

  private async readMany(driverIds: string[]): Promise<Array<string | null>> {
    if (driverIds.length === 0) return [];
    try {
      return await this.redis.getClient().mget(driverIds.map((driverId) => this.key(driverId)));
    } catch (error) {
      this.logger.warn(`Operational location read failed: ${this.errorMessage(error)}`);
      return driverIds.map(() => null);
    }
  }

  private async resolveLineHaulTripLocation(
    trip: LineHaulMapRecord,
  ): Promise<LineHaulTripLocationResponse> {
    if (trip.status !== LineHaulTripStatus.IN_TRANSIT) {
      return this.toLineHaulTripLocation(
        trip,
        {
          state: 'MISSING',
          location: null,
          capturedAt: null,
        },
        'DISABLED',
      );
    }
    const read = await this.readLineHaul(this.lineHaulKey(trip.id), trip.id, trip.driverId);
    const remaining = await this.remainingRoutes([trip], [read]);
    return this.toLineHaulTripLocation(trip, read, undefined, remaining.get(trip.id) ?? null);
  }

  private async readLineHaulMany(trips: LineHaulMapRecord[]): Promise<LineHaulLocationRead[]> {
    if (trips.length === 0) return [];
    try {
      const values = await this.redis
        .getClient()
        .mget(trips.map((trip) => this.lineHaulKey(trip.id)));
      return trips.map((trip, index) => this.parseLineHaul(values[index], trip.id, trip.driverId));
    } catch (error) {
      this.logger.warn(`Line-haul location read failed: ${this.errorMessage(error)}`);
      return trips.map(() => ({ state: 'UNAVAILABLE', location: null, capturedAt: null }));
    }
  }

  private async readLineHaul(
    key: string,
    tripId: string,
    driverId: string,
  ): Promise<LineHaulLocationRead> {
    try {
      return this.parseLineHaul(await this.redis.getClient().get(key), tripId, driverId);
    } catch (error) {
      this.logger.warn(`Line-haul location read failed for ${key}: ${this.errorMessage(error)}`);
      return { state: 'UNAVAILABLE', location: null, capturedAt: null };
    }
  }

  private parseLineHaul(
    value: string | null | undefined,
    tripId: string,
    driverId: string,
  ): LineHaulLocationRead {
    if (!value) return { state: 'MISSING', location: null, capturedAt: null };
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as StoredLineHaulLocation).tripId !== tripId ||
        (parsed as StoredLineHaulLocation).driverId !== driverId ||
        !Number.isFinite((parsed as StoredLineHaulLocation).latitude) ||
        (parsed as StoredLineHaulLocation).latitude < -90 ||
        (parsed as StoredLineHaulLocation).latitude > 90 ||
        !Number.isFinite((parsed as StoredLineHaulLocation).longitude) ||
        (parsed as StoredLineHaulLocation).longitude < -180 ||
        (parsed as StoredLineHaulLocation).longitude > 180 ||
        typeof (parsed as StoredLineHaulLocation).capturedAt !== 'string'
      ) {
        return { state: 'MISSING', location: null, capturedAt: null };
      }
      const stored = parsed as StoredLineHaulLocation;
      const capturedAt = Date.parse(stored.capturedAt);
      const age = Date.now() - capturedAt;
      if (!Number.isFinite(capturedAt) || age < 0 || age >= LOCATION_TTL_MILLISECONDS) {
        return { state: 'STALE', location: null, capturedAt: stored.capturedAt };
      }
      return {
        state: 'CURRENT',
        location: this.publicLineHaulLocation(stored),
        capturedAt: stored.capturedAt,
      };
    } catch {
      return { state: 'MISSING', location: null, capturedAt: null };
    }
  }

  private async toLineHaulTripLocation(
    trip: LineHaulMapRecord,
    read: LineHaulLocationRead,
    forcedState?: LineHaulLocationState,
    remainingRoute: RouteMetric | null = null,
  ): Promise<LineHaulTripLocationResponse> {
    const warehouse = (value: LineHaulMapRecord['originWarehouse']) => ({
      id: value.id,
      code: value.code,
      name: value.name,
      address: value.address,
      latitude: value.latitude === null ? null : Number(value.latitude),
      longitude: value.longitude === null ? null : Number(value.longitude),
    });
    const geometry = this.routeGeometry(trip.currentRoute?.geometry);
    const locationState = forcedState ?? read.state;
    const deviation =
      locationState === 'CURRENT' && trip.currentRoute && geometry && this.deviation
        ? await this.deviation.read(trip.id, trip.currentRoute.version)
        : { state: 'UNKNOWN' as const, distanceFromRouteMeters: null, detectedAt: null };
    return {
      tripId: trip.id,
      tripCode: trip.tripCode,
      status: trip.status,
      departedAt: trip.departedAt?.toISOString() ?? null,
      locationState,
      location: read.location,
      lastCapturedAt: read.capturedAt,
      route: trip.currentRoute
        ? {
            version: trip.currentRoute.version,
            type: trip.currentRoute.type,
            distanceMeters: trip.currentRoute.distanceMeters,
            durationSeconds: trip.currentRoute.durationSeconds,
            geometry,
            calculatedAt: trip.currentRoute.calculatedAt.toISOString(),
          }
        : null,
      remainingRoute: remainingRoute
        ? {
            distanceMeters: remainingRoute.distanceMeters,
            durationSeconds: remainingRoute.durationSeconds,
            mode: remainingRoute.mode,
            calculatedAt: remainingRoute.calculatedAt.toISOString(),
          }
        : null,
      deviation,
      driver: {
        id: trip.driver.id,
        fullName: trip.driver.user.fullName,
        employeeCode: trip.driver.employeeCode,
      },
      vehicle: trip.vehicle,
      origin: warehouse(trip.originWarehouse),
      destination: warehouse(trip.destinationWarehouse),
    };
  }

  private publicLineHaulLocation(stored: StoredLineHaulLocation): LineHaulLocationResponse {
    return {
      tripId: stored.tripId,
      latitude: stored.latitude,
      longitude: stored.longitude,
      capturedAt: stored.capturedAt,
    };
  }

  private async remainingRoutes(
    trips: LineHaulMapRecord[],
    reads: LineHaulLocationRead[],
  ): Promise<Map<string, RouteMetric>> {
    const result = new Map<string, RouteMetric>();
    if (!this.routes) return result;
    const eligible = trips.flatMap((trip, index) => {
      const location = reads[index]?.location;
      const latitude = trip.destinationWarehouse.latitude;
      const longitude = trip.destinationWarehouse.longitude;
      if (
        reads[index]?.state !== 'CURRENT' ||
        !location ||
        latitude === null ||
        longitude === null
      ) {
        return [];
      }
      return [
        {
          tripId: trip.id,
          request: {
            origin: { latitude: location.latitude, longitude: location.longitude },
            destination: { latitude: Number(latitude), longitude: Number(longitude) },
          },
        },
      ];
    });
    const metrics = await this.routes.calculateBatch(eligible.map((item) => item.request));
    eligible.forEach((item, index) => result.set(item.tripId, metrics[index]));
    return result;
  }

  private routeGeometry(value: Prisma.JsonValue | null | undefined): RouteGeometry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const points = (value as { points?: unknown }).points;
    if (!Array.isArray(points) || points.length < 2 || points.length > 2_000) return null;
    const normalized = points.flatMap((point) => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
      const latitude = (point as { latitude?: unknown }).latitude;
      const longitude = (point as { longitude?: unknown }).longitude;
      return Number.isFinite(latitude) &&
        Number(latitude) >= -90 &&
        Number(latitude) <= 90 &&
        Number.isFinite(longitude) &&
        Number(longitude) >= -180 &&
        Number(longitude) <= 180
        ? [{ latitude: Number(latitude), longitude: Number(longitude) }]
        : [];
    });
    return normalized.length === points.length ? { points: normalized } : null;
  }

  private async assertLineHaulReadAccess(
    actor: AuthenticatedUser,
    trip: Pick<LineHaulMapRecord, 'driverId' | 'originWarehouseId' | 'destinationWarehouseId'>,
  ): Promise<void> {
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.DISPATCHER) return;
    if (actor.role === UserRole.DRIVER) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (driver?.id === trip.driverId) return;
    }
    if (actor.role === UserRole.WAREHOUSE_STAFF) {
      const warehouseId = await this.resolveWarehouseScope(actor);
      if (warehouseId === trip.originWarehouseId || warehouseId === trip.destinationWarehouseId) {
        return;
      }
    }
    throw new ForbiddenException({
      code: 'LINE_HAUL_LOCATION_SCOPE_FORBIDDEN',
      message: 'Line-haul location is outside the authenticated resource scope',
    });
  }

  private async resolveWarehouseScope(actor: AuthenticatedUser): Promise<string | null> {
    if (actor.role !== UserRole.WAREHOUSE_STAFF) return null;
    const profile = await this.prisma.warehouseStaffProfile.findUnique({
      where: { userId: actor.id },
      select: { warehouseId: true, isActive: true },
    });
    if (!profile?.isActive) {
      throw new ForbiddenException({
        code: 'LINE_HAUL_LOCATION_SCOPE_FORBIDDEN',
        message: 'An active warehouse assignment is required to view line-haul locations',
      });
    }
    return profile.warehouseId;
  }

  private parse(value: string | null | undefined): DriverLocationResponse | null {
    if (!value) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as DriverLocationResponse).driverId === 'string' &&
        Number.isFinite((parsed as DriverLocationResponse).latitude) &&
        (parsed as DriverLocationResponse).latitude >= -90 &&
        (parsed as DriverLocationResponse).latitude <= 90 &&
        Number.isFinite((parsed as DriverLocationResponse).longitude) &&
        (parsed as DriverLocationResponse).longitude >= -180 &&
        (parsed as DriverLocationResponse).longitude <= 180 &&
        typeof (parsed as DriverLocationResponse).updatedAt === 'string'
      ) {
        const location = parsed as DriverLocationResponse;
        const updatedAt = Date.parse(location.updatedAt);
        if (Number.isFinite(updatedAt) && Date.now() - updatedAt < LOCATION_TTL_MILLISECONDS) {
          return location;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private key(driverId: string): string {
    return `driver:location:${driverId}`;
  }

  private lineHaulKey(tripId: string): string {
    return `linehaul:trip:location:${tripId}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? redactSensitiveText(error.message) : 'unknown Redis error';
  }

  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
