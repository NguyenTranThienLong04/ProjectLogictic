import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus, TrackingVisibility } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CacheService } from '../../redis/cache.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { toShippingFeeTransactionResponse } from '../shipping-fees/shipping-fee.response.js';
import { ShippingFeesService } from '../shipping-fees/shipping-fees.service.js';
import type { CancelShipmentDto } from './dto/cancel-shipment.dto.js';
import type { CreateShipmentDto } from './dto/create-shipment.dto.js';
import type { ListShipmentsDto } from './dto/list-shipments.dto.js';
import { CancellationPolicy } from './cancellation.policy.js';
import {
  mapTimeline,
  type AddressSnapshot,
  type ContactSnapshot,
  type PackageSnapshot,
  type PaginatedShipmentsResponse,
  type ShipmentResponse,
  type ShipmentSummaryResponse,
  type ShipmentWithShippingFee,
  type ShipmentWithTimeline,
} from './shipment.response.js';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly cancellationPolicy: CancellationPolicy,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly shippingFees: ShippingFeesService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateShipmentDto,
    context: ClientContext,
  ): Promise<ShipmentResponse> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const shipment = await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.shipment.findUnique({
            where: {
              customerId_clientRequestId: {
                customerId: user.id,
                clientRequestId: dto.clientRequestId,
              },
            },
            include: {
              trackingEvents: { orderBy: { createdAt: 'asc' } },
              shippingFeeTransaction: true,
            },
          });
          if (existing) return existing;

          const pickupAddress = await transaction.customerAddress.findFirst({
            where: { id: dto.pickupAddressId, customerId: user.id },
          });
          const customer = await transaction.user.findUnique({ where: { id: user.id } });
          const pricingConfig = await this.pricingService.getActiveConfigEntity(transaction);
          if (!pickupAddress) {
            throw new NotFoundException({
              code: 'ADDRESS_NOT_FOUND',
              message: 'Pickup address was not found',
            });
          }
          if (!customer) {
            throw new NotFoundException({
              code: 'USER_NOT_FOUND',
              message: 'User was not found',
            });
          }

          const pricing = this.pricingService.calculate(
            dto.package.weightGrams,
            dto.codAmount,
            pricingConfig,
          );
          const pickupSnapshot = this.pickupSnapshot(pickupAddress);
          const deliverySnapshot = this.deliverySnapshot(dto.deliveryAddress);
          const senderSnapshot: ContactSnapshot = {
            fullName: customer.fullName,
            email: customer.email,
            phone: customer.phone,
          };
          const receiverSnapshot: ContactSnapshot = {
            fullName: dto.deliveryAddress.contactName.trim(),
            phone: dto.deliveryAddress.phone.trim(),
          };
          const packageSnapshot: PackageSnapshot = {
            description: dto.package.description.trim(),
            packageType: dto.package.packageType.trim().toUpperCase(),
            weightGrams: dto.package.weightGrams,
            lengthCm: dto.package.lengthCm,
            widthCm: dto.package.widthCm,
            heightCm: dto.package.heightCm,
          };

          const created = await transaction.shipment.create({
            data: {
              trackingCode: this.generateTrackingCode(),
              clientRequestId: dto.clientRequestId,
              customerId: user.id,
              senderSnapshot: senderSnapshot as unknown as Prisma.InputJsonValue,
              receiverSnapshot: receiverSnapshot as unknown as Prisma.InputJsonValue,
              pickupSnapshot: pickupSnapshot as unknown as Prisma.InputJsonValue,
              deliverySnapshot: deliverySnapshot as unknown as Prisma.InputJsonValue,
              packageSnapshot: packageSnapshot as unknown as Prisma.InputJsonValue,
              pricingSnapshot: pricing as unknown as Prisma.InputJsonValue,
              codAmount: dto.codAmount,
              totalFee: pricing.totalFee,
              shippingFeePayer: dto.shippingFeePayer,
            },
          });
          await this.shippingFees.createPending(transaction, created);
          await transaction.trackingEvent.create({
            data: {
              shipmentId: created.id,
              status: ShipmentStatus.PENDING,
              type: 'SHIPMENT_CREATED',
              title: 'Đã tạo vận đơn',
              description: 'Vận đơn đang chờ điều phối xác nhận.',
              visibility: TrackingVisibility.PUBLIC,
              actorId: user.id,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorId: user.id,
              actorRole: user.role,
              action: 'SHIPMENT_CREATE',
              entityType: 'Shipment',
              entityId: created.id,
              after: {
                status: created.status,
                trackingCode: created.trackingCode,
                totalFee: created.totalFee,
                shippingFeePayer: created.shippingFeePayer,
                pricingConfigVersion: pricing.configVersion,
              },
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            },
          });
          await this.notifications.createIdempotent(transaction, [
            {
              userId: user.id,
              eventKey: `shipment:${created.id}:created`,
              type: 'SHIPMENT_CREATED',
              title: 'Đã tạo vận đơn',
              message: `${created.trackingCode} đã được tạo và đang chờ xác nhận.`,
              data: { shipmentId: created.id, trackingCode: created.trackingCode },
            },
          ]);
          return transaction.shipment.findUniqueOrThrow({
            where: { id: created.id },
            include: {
              trackingEvents: { orderBy: { createdAt: 'asc' } },
              shippingFeeTransaction: true,
            },
          });
        });
        await this.notifications.publishByEventKeys([`shipment:${shipment.id}:created`]);
        return this.toResponse(shipment);
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.findByIdempotencyKey(user.id, dto.clientRequestId);
          if (existing) return this.toResponse(existing);
          if (attempt < 4) continue;
          throw new ConflictException({
            code: 'SHIPMENT_TRACKING_CODE_CONFLICT',
            message: 'Could not allocate a tracking code; retry the request',
          });
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: 'SHIPMENT_CREATE_CONFLICT',
      message: 'Shipment could not be created; retry the request',
    });
  }

  async list(customerId: string, query: ListShipmentsDto): Promise<PaginatedShipmentsResponse> {
    const where: Prisma.ShipmentWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };
    const items = await this.prisma.shipment.findMany({
      where,
      include: { shippingFeeTransaction: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const total = await this.prisma.shipment.count({ where });
    return {
      items: items.map((shipment) => this.toSummary(shipment)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getOwned(customerId: string, shipmentId: string): Promise<ShipmentResponse> {
    const owned = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, customerId },
      select: { id: true },
    });
    if (!owned) throw this.notFound();
    const cacheKey = this.cache.shipmentSummaryKey(shipmentId);
    const cached = await this.cache.get<ShipmentResponse>(cacheKey);
    if (cached?.shippingFee) return cached;
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        trackingEvents: { orderBy: { createdAt: 'asc' } },
        shippingFeeTransaction: true,
      },
    });
    const response = this.toResponse(shipment);
    await this.cache.set(cacheKey, response, this.cache.shipmentTtlSeconds);
    return response;
  }

  async cancel(
    user: AuthenticatedUser,
    shipmentId: string,
    dto: CancelShipmentDto,
    context: ClientContext,
  ): Promise<ShipmentResponse> {
    const shipment = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.shipment.findFirst({
        where: { id: shipmentId, customerId: user.id },
        include: { shippingFeeTransaction: true },
      });
      if (!current) throw this.notFound();
      this.cancellationPolicy.assertCustomerCanCancel(current.status);

      const cancelledAt = new Date();
      const update = await transaction.shipment.updateMany({
        where: {
          id: current.id,
          customerId: user.id,
          status: current.status,
          version: current.version,
        },
        data: {
          status: ShipmentStatus.CANCELLED,
          version: { increment: 1 },
          cancelledById: user.id,
          cancelledAt,
          cancellationReason: dto.reason.trim(),
          cancellationPreviousStatus: current.status,
        },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'SHIPMENT_CONCURRENT_MODIFICATION',
          message: 'Shipment changed concurrently; reload and try again',
        });
      }

      await this.shippingFees.cancelPending(transaction, {
        shipment: current,
        actor: user,
        cancelledAt,
        context,
      });

      await transaction.trackingEvent.create({
        data: {
          shipmentId: current.id,
          status: ShipmentStatus.CANCELLED,
          type: 'SHIPMENT_CANCELLED',
          title: 'Đã hủy vận đơn',
          description: dto.reason.trim(),
          visibility: TrackingVisibility.PUBLIC,
          actorId: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'SHIPMENT_CANCEL',
          entityType: 'Shipment',
          entityId: current.id,
          before: { status: current.status, version: current.version },
          after: { status: ShipmentStatus.CANCELLED, version: current.version + 1 },
          metadata: { reason: dto.reason.trim() },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return transaction.shipment.findUniqueOrThrow({
        where: { id: current.id },
        include: {
          trackingEvents: { orderBy: { createdAt: 'asc' } },
          shippingFeeTransaction: true,
        },
      });
    });
    await this.cache.invalidateShipment(shipment.id, shipment.trackingCode);
    return this.toResponse(shipment);
  }

  async publicTracking(trackingCode: string): Promise<{
    trackingCode: string;
    status: ShipmentStatus;
    originCity: string;
    destinationCity: string;
    createdAt: Date;
    timeline: ReturnType<typeof mapTimeline>[];
  }> {
    const normalizedTrackingCode = trackingCode.trim().toUpperCase();
    const cacheKey = this.cache.trackingKey(normalizedTrackingCode);
    const cached = await this.cache.get<{
      trackingCode: string;
      status: ShipmentStatus;
      originCity: string;
      destinationCity: string;
      createdAt: Date;
      timeline: ReturnType<typeof mapTimeline>[];
    }>(cacheKey);
    if (cached) return cached;
    const shipment = await this.prisma.shipment.findUnique({
      where: { trackingCode: normalizedTrackingCode },
      include: {
        trackingEvents: {
          where: { visibility: TrackingVisibility.PUBLIC },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shipment) throw this.notFound();
    const pickup = shipment.pickupSnapshot as unknown as AddressSnapshot;
    const delivery = shipment.deliverySnapshot as unknown as AddressSnapshot;
    const response = {
      trackingCode: shipment.trackingCode,
      status: shipment.status,
      originCity: pickup.city,
      destinationCity: delivery.city,
      createdAt: shipment.createdAt,
      timeline: shipment.trackingEvents.map(mapTimeline),
    };
    await this.cache.set(cacheKey, response, this.cache.trackingTtlSeconds);
    return response;
  }

  private async findByIdempotencyKey(
    customerId: string,
    clientRequestId: string,
  ): Promise<ShipmentWithTimeline | null> {
    return this.prisma.shipment.findUnique({
      where: { customerId_clientRequestId: { customerId, clientRequestId } },
      include: {
        trackingEvents: { orderBy: { createdAt: 'asc' } },
        shippingFeeTransaction: true,
      },
    });
  }

  private toResponse(shipment: ShipmentWithTimeline): ShipmentResponse {
    return {
      id: shipment.id,
      trackingCode: shipment.trackingCode,
      status: shipment.status,
      sender: shipment.senderSnapshot as unknown as ContactSnapshot,
      receiver: shipment.receiverSnapshot as unknown as ContactSnapshot,
      pickup: shipment.pickupSnapshot as unknown as AddressSnapshot,
      delivery: shipment.deliverySnapshot as unknown as AddressSnapshot,
      package: shipment.packageSnapshot as unknown as PackageSnapshot,
      pricing: shipment.pricingSnapshot as unknown as ShipmentResponse['pricing'],
      codAmount: shipment.codAmount,
      totalFee: shipment.totalFee,
      shippingFeePayer: shipment.shippingFeePayer,
      shippingFee: toShippingFeeTransactionResponse(
        this.requireShippingFee(shipment.shippingFeeTransaction),
      ),
      canCancel: this.cancellationPolicy.canCustomerCancel(shipment.status),
      cancellationReason: shipment.cancellationReason,
      cancelledAt: shipment.cancelledAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      timeline: shipment.trackingEvents.map(mapTimeline),
    };
  }

  private toSummary(shipment: ShipmentWithShippingFee): ShipmentSummaryResponse {
    const receiver = shipment.receiverSnapshot as unknown as ContactSnapshot;
    const delivery = shipment.deliverySnapshot as unknown as AddressSnapshot;
    return {
      id: shipment.id,
      trackingCode: shipment.trackingCode,
      status: shipment.status,
      receiverName: receiver.fullName,
      deliveryCity: delivery.city,
      totalFee: shipment.totalFee,
      codAmount: shipment.codAmount,
      shippingFeePayer: shipment.shippingFeePayer,
      shippingFee: toShippingFeeTransactionResponse(
        this.requireShippingFee(shipment.shippingFeeTransaction),
      ),
      createdAt: shipment.createdAt,
    };
  }

  private pickupSnapshot(address: {
    contactName: string;
    phone: string;
    streetAddress: string;
    ward: string;
    district: string;
    city: string;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  }): AddressSnapshot {
    return {
      contactName: address.contactName,
      phone: address.phone,
      streetAddress: address.streetAddress,
      ward: address.ward,
      district: address.district,
      city: address.city,
      latitude: address.latitude === null ? null : Number(address.latitude),
      longitude: address.longitude === null ? null : Number(address.longitude),
    };
  }

  private deliverySnapshot(address: CreateShipmentDto['deliveryAddress']): AddressSnapshot {
    return {
      contactName: address.contactName.trim(),
      phone: address.phone.trim(),
      streetAddress: address.streetAddress.trim(),
      ward: address.ward.trim(),
      district: address.district.trim(),
      city: address.city.trim(),
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
    };
  }

  private generateTrackingCode(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `SHP-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private requireShippingFee(
    transaction: ShipmentWithTimeline['shippingFeeTransaction'],
  ): NonNullable<ShipmentWithTimeline['shippingFeeTransaction']> {
    if (!transaction) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_SNAPSHOT_INVALID',
        message: 'Shipping fee snapshot is missing for this shipment',
      });
    }
    return transaction;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'SHIPMENT_NOT_FOUND',
      message: 'Shipment was not found',
    });
  }
}
