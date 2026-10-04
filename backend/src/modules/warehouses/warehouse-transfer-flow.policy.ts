import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseLineHaulEnforcementFrom } from '../../config/line-haul-enforcement.js';
import { LineHaulTripStatus, WarehouseTransferStatus } from '../../generated/prisma/client.js';

@Injectable()
export class WarehouseTransferFlowPolicy {
  private readonly cutover: Date | null;

  constructor(config: ConfigService) {
    this.cutover = parseLineHaulEnforcementFrom(config.get<string>('LINE_HAUL_ENFORCEMENT_FROM'));
  }

  get enforcementFrom(): string | null {
    return this.cutover?.toISOString() ?? null;
  }

  isEnforced(now = new Date()): boolean {
    return this.cutover !== null && now >= this.cutover;
  }

  isLegacyStandalone(dispatchedAt: Date | null): boolean {
    return this.cutover !== null && dispatchedAt !== null && dispatchedAt < this.cutover;
  }

  assertStandaloneDispatch(now = new Date()): void {
    if (this.isEnforced(now)) {
      throw new ConflictException({
        code: 'LINE_HAUL_TRIP_REQUIRED',
        message: 'Assign this pending transfer to a line-haul trip and depart the trip',
      });
    }
  }

  assertStandaloneReceive(dispatchedAt: Date | null): void {
    if (this.isEnforced() && !this.isLegacyStandalone(dispatchedAt)) {
      throw new ConflictException({
        code: 'LINE_HAUL_LEGACY_RECEIVE_NOT_ELIGIBLE',
        message:
          'Only standalone transfers dispatched before the cutover can be received without a trip',
      });
    }
  }

  describe(transfer: {
    status: WarehouseTransferStatus;
    dispatchedAt: Date | null;
    lineHaulTripAssignments?: Array<{ trip: { status: LineHaulTripStatus } }>;
  }) {
    const trip = transfer.lineHaulTripAssignments?.[0]?.trip;
    const enforced = this.isEnforced();
    const legacyStandalone = !trip && this.isLegacyStandalone(transfer.dispatchedAt);
    return {
      lineHaulRequired: enforced,
      enforcementFrom: this.enforcementFrom,
      legacyStandalone,
      canStandaloneDispatch:
        transfer.status === WarehouseTransferStatus.PENDING && !trip && !enforced,
      canReceive:
        transfer.status === WarehouseTransferStatus.IN_TRANSIT &&
        (trip ? trip.status === LineHaulTripStatus.ARRIVED : !enforced || legacyStandalone),
    };
  }
}
