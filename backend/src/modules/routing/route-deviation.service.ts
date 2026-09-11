import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redactSensitiveText } from '../../common/logging/structured-log.js';
import { RedisService } from '../../redis/redis.service.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import type { RouteGeometry, RoutePoint } from './route-provider.js';

export type RouteDeviationState = 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN';

export interface RouteDeviationSnapshot {
  state: RouteDeviationState;
  distanceFromRouteMeters: number | null;
  detectedAt: string | null;
}

interface StoredRouteDeviation extends RouteDeviationSnapshot {
  tripId: string;
  routeVersion: number;
  consecutiveDeviatedSamples: number;
  lastSampleAt: string;
}

const DEVIATION_TTL_SECONDS = 60;

@Injectable()
export class RouteDeviationService {
  private readonly logger = new Logger(RouteDeviationService.name);
  private readonly thresholdMeters: number;
  private readonly requiredConsecutiveSamples: number;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsGateway,
  ) {
    this.thresholdMeters = Number(config.getOrThrow<string>('LINE_HAUL_ROUTE_DEVIATION_METERS'));
    this.requiredConsecutiveSamples = Number(
      config.getOrThrow<string>('LINE_HAUL_ROUTE_DEVIATION_CONSECUTIVE_SAMPLES'),
    );
  }

  async evaluate(input: {
    tripId: string;
    routeVersion: number;
    geometry: RouteGeometry;
    location: RoutePoint;
    capturedAt: string;
  }): Promise<RouteDeviationSnapshot> {
    const distanceFromRouteMeters = Math.round(
      distanceToRouteMeters(input.location, input.geometry),
    );
    const previous = await this.readStored(input.tripId, input.routeVersion);
    const outside = distanceFromRouteMeters > this.thresholdMeters;
    const consecutiveDeviatedSamples = outside
      ? (previous?.consecutiveDeviatedSamples ?? 0) + 1
      : 0;
    const previousState = previous?.state ?? 'UNKNOWN';
    const state: RouteDeviationState = outside
      ? previousState === 'DEVIATED' ||
        consecutiveDeviatedSamples >= this.requiredConsecutiveSamples
        ? 'DEVIATED'
        : previousState
      : 'ON_ROUTE';
    const changed = state !== previousState;
    const detectedAt = changed ? input.capturedAt : (previous?.detectedAt ?? input.capturedAt);
    const stored: StoredRouteDeviation = {
      tripId: input.tripId,
      routeVersion: input.routeVersion,
      state,
      distanceFromRouteMeters,
      detectedAt,
      consecutiveDeviatedSamples,
      lastSampleAt: input.capturedAt,
    };

    try {
      await this.redis
        .getClient()
        .set(
          this.key(input.tripId, input.routeVersion),
          JSON.stringify(stored),
          'EX',
          DEVIATION_TTL_SECONDS,
        );
    } catch (error) {
      this.logger.warn(`Route deviation write failed: ${this.errorMessage(error)}`);
      return this.unknown();
    }

    const snapshot = this.publicSnapshot(stored);
    if (changed) {
      await this.notifications.emitLineHaulRouteDeviationChanged({
        tripId: input.tripId,
        ...snapshot,
        detectedAt: snapshot.detectedAt ?? input.capturedAt,
      });
    }
    return snapshot;
  }

  async read(tripId: string, routeVersion: number): Promise<RouteDeviationSnapshot> {
    const stored = await this.readStored(tripId, routeVersion);
    return stored ? this.publicSnapshot(stored) : this.unknown();
  }

  async announceRouteReset(
    tripId: string,
    previousRouteVersion: number,
    newRouteVersion: number,
    detectedAt: string,
  ): Promise<void> {
    const previous = await this.readStored(tripId, previousRouteVersion);
    if (!previous || previous.state === 'UNKNOWN' || previousRouteVersion === newRouteVersion)
      return;
    await this.notifications.emitLineHaulRouteDeviationChanged({
      tripId,
      state: 'UNKNOWN',
      distanceFromRouteMeters: null,
      detectedAt,
    });
  }

  private async readStored(
    tripId: string,
    routeVersion: number,
  ): Promise<StoredRouteDeviation | null> {
    try {
      const value = await this.redis.getClient().get(this.key(tripId, routeVersion));
      if (!value) return null;
      const parsed: unknown = JSON.parse(value);
      if (!this.isStored(parsed, tripId, routeVersion)) return null;
      return parsed;
    } catch (error) {
      this.logger.warn(`Route deviation read failed: ${this.errorMessage(error)}`);
      return null;
    }
  }

  private isStored(
    value: unknown,
    tripId: string,
    routeVersion: number,
  ): value is StoredRouteDeviation {
    if (!value || typeof value !== 'object') return false;
    const stored = value as StoredRouteDeviation;
    return (
      stored.tripId === tripId &&
      stored.routeVersion === routeVersion &&
      ['ON_ROUTE', 'DEVIATED', 'UNKNOWN'].includes(stored.state) &&
      (stored.distanceFromRouteMeters === null ||
        (Number.isFinite(stored.distanceFromRouteMeters) && stored.distanceFromRouteMeters >= 0)) &&
      Number.isInteger(stored.consecutiveDeviatedSamples) &&
      stored.consecutiveDeviatedSamples >= 0 &&
      typeof stored.lastSampleAt === 'string' &&
      (stored.detectedAt === null || typeof stored.detectedAt === 'string')
    );
  }

  private publicSnapshot(stored: StoredRouteDeviation): RouteDeviationSnapshot {
    return {
      state: stored.state,
      distanceFromRouteMeters: stored.distanceFromRouteMeters,
      detectedAt: stored.detectedAt,
    };
  }

  private unknown(): RouteDeviationSnapshot {
    return { state: 'UNKNOWN', distanceFromRouteMeters: null, detectedAt: null };
  }

  private key(tripId: string, routeVersion: number): string {
    return `linehaul:trip:deviation:${tripId}:route:${routeVersion}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? redactSensitiveText(error.message) : 'unknown Redis error';
  }
}

export function distanceToRouteMeters(point: RoutePoint, geometry: RouteGeometry): number {
  if (geometry.points.length < 2) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < geometry.points.length; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToSegmentMeters(point, geometry.points[index - 1], geometry.points[index]),
    );
  }
  return nearest;
}

function distanceToSegmentMeters(point: RoutePoint, start: RoutePoint, end: RoutePoint): number {
  const earthRadius = 6_371_008.8;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const cosineLatitude = Math.cos(radians(point.latitude));
  const project = (candidate: RoutePoint) => ({
    x: radians(candidate.longitude - point.longitude) * cosineLatitude * earthRadius,
    y: radians(candidate.latitude - point.latitude) * earthRadius,
  });
  const from = project(start);
  const to = project(end);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(from.x * dx + from.y * dy) / lengthSquared));
  return Math.hypot(from.x + ratio * dx, from.y + ratio * dy);
}
