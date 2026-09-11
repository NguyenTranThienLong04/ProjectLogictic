import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ShippingFeePayer,
  ShippingFeePaymentEventType,
  ShippingFeePaymentStatus,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  UserRole,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { CacheService } from '../../../redis/cache.service.js';
import type { AuthenticatedUser, ClientContext } from '../../auth/auth.types.js';
import type { CreateShippingFeePaymentDto } from '../dto/create-shipping-fee-payment.dto.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import { InvalidPaymentWebhookError } from './payment-provider.js';

const paymentInclude = {
  shippingFeeTransaction: {
    include: {
      shipment: {
        select: {
          id: true,
          trackingCode: true,
          customerId: true,
          shippingFeePayer: true,
          totalFee: true,
          status: true,
        },
      },
    },
  },
} as const satisfies Prisma.ShippingFeePaymentInclude;

type PaymentWithShipment = Prisma.ShippingFeePaymentGetPayload<{ include: typeof paymentInclude }>;

@Injectable()
export class ShippingFeePaymentsService {
  private readonly returnUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.returnUrl = new URL(
      '/payments/result',
      config.getOrThrow<string>('FRONTEND_URL'),
    ).toString();
  }

  async getForShipment(actor: AuthenticatedUser, shipmentId: string) {
    this.assertCustomer(actor);
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, customerId: actor.id },
      include: {
        shippingFeeTransaction: {
          include: { payments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
        },
      },
    });
    if (!shipment?.shippingFeeTransaction) this.paymentNotFound();
    this.assertFeeSnapshot(shipment.shippingFeeTransaction, shipment);
    const latest = shipment.shippingFeeTransaction.payments[0] ?? null;
    const availability = this.availability(
      shipment.status,
      shipment.shippingFeeTransaction.status,
      shipment.shippingFeePayer,
    );
    return {
      availableActions: { createPayment: availability.available },
      unavailableReason: availability.reason,
      payment: latest
        ? this.toResponse(
            { ...latest, shippingFeeTransaction: { ...shipment.shippingFeeTransaction, shipment } },
            null,
          )
        : null,
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateShippingFeePaymentDto, context: ClientContext) {
    this.assertCustomer(actor);
    if (!this.gateway.enabled) this.providerUnavailable();

    const paymentId = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id: dto.shipmentId, customerId: actor.id },
        include: { shippingFeeTransaction: true },
      });
      if (!shipment?.shippingFeeTransaction) this.paymentNotFound();
      const feeId = shipment.shippingFeeTransaction.id;
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ShippingFeeTransaction" WHERE "id" = ${feeId}::uuid FOR UPDATE
      `);
      const fee = await tx.shippingFeeTransaction.findUniqueOrThrow({ where: { id: feeId } });
      this.assertFeeSnapshot(fee, shipment);

      const existing = await tx.shippingFeePayment.findUnique({
        where: {
          shippingFeeTransactionId_clientRequestId: {
            shippingFeeTransactionId: fee.id,
            clientRequestId: dto.clientRequestId,
          },
        },
      });
      if (existing) {
        if (
          existing.initiatedById !== actor.id ||
          existing.provider !== this.gateway.providerCode ||
          existing.payer !== fee.payer ||
          existing.amount !== fee.expectedAmount
        ) {
          throw new ConflictException({
            code: 'SHIPPING_FEE_PAYMENT_IDEMPOTENCY_CONFLICT',
            message: 'Payment idempotency key is already bound to different payment data',
          });
        }
        return existing.id;
      }

      const availability = this.availability(shipment.status, fee.status, fee.payer);
      if (!availability.available) {
        throw new ConflictException({
          code: availability.reason ?? 'SHIPPING_FEE_PAYMENT_NOT_AVAILABLE',
          message: 'Online payment is not available at this shipping-fee lifecycle point',
        });
      }
      const active = await tx.shippingFeePayment.findFirst({
        where: {
          shippingFeeTransactionId: fee.id,
          status: { in: [ShippingFeePaymentStatus.CREATING, ShippingFeePaymentStatus.PENDING] },
        },
      });
      if (active) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_PAYMENT_ALREADY_PENDING',
          message: 'Another online payment is still pending confirmation',
        });
      }

      const feeChanged = await tx.shippingFeeTransaction.updateMany({
        where: {
          id: fee.id,
          status: ShippingFeeTransactionStatus.PENDING,
          payer: fee.payer,
          expectedAmount: fee.expectedAmount,
        },
        data: { status: ShippingFeeTransactionStatus.PAYMENT_PENDING },
      });
      if (feeChanged.count !== 1) this.concurrentModification();

      const id = randomUUID();
      const reference = `SFP-${id.replaceAll('-', '').toUpperCase()}`;
      const payment = await tx.shippingFeePayment.create({
        data: {
          id,
          shippingFeeTransactionId: fee.id,
          clientRequestId: dto.clientRequestId,
          reference,
          provider: this.gateway.providerCode,
          payer: fee.payer,
          amount: fee.expectedAmount,
          initiatedById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'SHIPPING_FEE_PAYMENT_CREATED',
          entityType: 'ShippingFeePayment',
          entityId: payment.id,
          before: { feeStatus: fee.status },
          after: {
            feeStatus: ShippingFeeTransactionStatus.PAYMENT_PENDING,
            paymentStatus: payment.status,
          },
          metadata: {
            shipmentId: shipment.id,
            shippingFeeTransactionId: fee.id,
            reference: payment.reference,
            payer: fee.payer,
            amount: fee.expectedAmount,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return payment.id;
    });

    const beforeProvider = await this.findOwnedPayment(paymentId, actor.id);
    await this.cache.invalidateShipment(
      beforeProvider.shippingFeeTransaction.shipment.id,
      beforeProvider.shippingFeeTransaction.shipment.trackingCode,
    );
    if (
      beforeProvider.status === ShippingFeePaymentStatus.SUCCEEDED ||
      beforeProvider.status === ShippingFeePaymentStatus.FAILED
    ) {
      return this.toResponse(beforeProvider, null);
    }

    let checkout;
    try {
      checkout = await this.gateway.createPayment({
        reference: beforeProvider.reference,
        amount: beforeProvider.amount,
        payer: beforeProvider.payer,
        returnUrl: this.returnUrl,
        idempotencyKey: beforeProvider.reference,
      });
    } catch {
      this.providerUnavailable();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ShippingFeePayment" WHERE "id" = ${paymentId}::uuid FOR UPDATE
      `);
      const current = await tx.shippingFeePayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.status === ShippingFeePaymentStatus.SUCCEEDED) return;
      if (current.status === ShippingFeePaymentStatus.FAILED) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_PAYMENT_FAILED',
          message: 'Payment was rejected before checkout could be resumed',
        });
      }
      if (current.providerReference && current.providerReference !== checkout.providerReference) {
        throw new ConflictException({
          code: 'SHIPPING_FEE_PAYMENT_PROVIDER_REFERENCE_CONFLICT',
          message: 'Payment provider reference does not match the existing attempt',
        });
      }
      if (current.status === ShippingFeePaymentStatus.CREATING) {
        const changed = await tx.shippingFeePayment.updateMany({
          where: { id: current.id, status: ShippingFeePaymentStatus.CREATING },
          data: {
            status: ShippingFeePaymentStatus.PENDING,
            providerReference: checkout.providerReference,
            providerAcceptedAt: new Date(),
          },
        });
        if (changed.count !== 1) this.concurrentModification();
      }
    });
    return this.toResponse(await this.findOwnedPayment(paymentId, actor.id), checkout.checkoutUrl);
  }

  async getResult(actor: AuthenticatedUser, reference: string) {
    this.assertCustomer(actor);
    const payment = await this.prisma.shippingFeePayment.findFirst({
      where: {
        reference,
        initiatedById: actor.id,
        shippingFeeTransaction: { shipment: { customerId: actor.id } },
      },
      include: paymentInclude,
    });
    if (!payment) this.paymentNotFound();
    this.assertPaymentOwnership(payment);
    return this.toResponse(payment, null);
  }

  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    context: ClientContext,
  ) {
    let webhook;
    try {
      webhook = this.gateway.verifyWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof InvalidPaymentWebhookError) {
        throw new BadRequestException({
          code: 'SHIPPING_FEE_PAYMENT_WEBHOOK_INVALID',
          message: 'Payment webhook signature or payload is invalid',
        });
      }
      throw error;
    }
    const provider = this.gateway.providerCode;
    const payloadDigest = createHash('sha256').update(rawBody).digest('hex');

    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.shippingFeePayment.findUnique({
        where: { reference: webhook.reference },
      });
      if (!initial || initial.provider !== provider) this.paymentNotFound();
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ShippingFeePayment" WHERE "id" = ${initial.id}::uuid FOR UPDATE
      `);
      const payment = await tx.shippingFeePayment.findUniqueOrThrow({
        where: { id: initial.id },
        include: paymentInclude,
      });
      const existingEvent = await tx.shippingFeePaymentEvent.findUnique({
        where: { provider_providerEventId: { provider, providerEventId: webhook.eventId } },
      });
      if (existingEvent) {
        if (
          existingEvent.paymentId !== payment.id ||
          existingEvent.payloadDigest !== payloadDigest
        ) {
          throw new ConflictException({
            code: 'SHIPPING_FEE_PAYMENT_WEBHOOK_REPLAY_CONFLICT',
            message: 'Payment webhook event identifier was replayed with different data',
          });
        }
        return {
          accepted: true,
          duplicate: true,
          paymentStatus: payment.status,
          shipmentId: payment.shippingFeeTransaction.shipment.id,
          trackingCode: payment.shippingFeeTransaction.shipment.trackingCode,
        };
      }

      this.assertPaymentOwnership(payment);
      if (payment.providerReference && payment.providerReference !== webhook.providerReference) {
        throw new BadRequestException({
          code: 'SHIPPING_FEE_PAYMENT_REFERENCE_MISMATCH',
          message: 'Payment provider reference does not match the payment attempt',
        });
      }
      if (webhook.amount !== payment.amount) {
        throw new BadRequestException({
          code: 'SHIPPING_FEE_PAYMENT_AMOUNT_MISMATCH',
          message: 'Payment webhook amount does not match the immutable shipping fee',
        });
      }

      if (webhook.status === 'SUCCEEDED') {
        await this.applySucceededWebhook(tx, payment, webhook, context);
      } else {
        await this.applyFailedWebhook(tx, payment, webhook, context);
      }
      await tx.shippingFeePaymentEvent.create({
        data: {
          paymentId: payment.id,
          provider,
          providerEventId: webhook.eventId,
          payloadDigest,
          type:
            webhook.status === 'SUCCEEDED'
              ? ShippingFeePaymentEventType.SUCCEEDED
              : ShippingFeePaymentEventType.FAILED,
          amount: webhook.amount,
          occurredAt: webhook.occurredAt,
          processedAt: new Date(),
        },
      });
      const updated = await tx.shippingFeePayment.findUniqueOrThrow({ where: { id: payment.id } });
      return {
        accepted: true,
        duplicate: false,
        paymentStatus: updated.status,
        shipmentId: payment.shippingFeeTransaction.shipment.id,
        trackingCode: payment.shippingFeeTransaction.shipment.trackingCode,
      };
    });
    await this.cache.invalidateShipment(result.shipmentId, result.trackingCode);
    return {
      accepted: result.accepted,
      duplicate: result.duplicate,
      paymentStatus: result.paymentStatus,
    };
  }

  private async applySucceededWebhook(
    tx: Prisma.TransactionClient,
    payment: PaymentWithShipment,
    webhook: {
      providerReference: string;
      occurredAt: Date;
    },
    context: ClientContext,
  ): Promise<void> {
    const fee = payment.shippingFeeTransaction;
    if (payment.status === ShippingFeePaymentStatus.FAILED) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_TERMINAL_CONFLICT',
        message: 'A failed payment cannot later be changed to succeeded',
      });
    }
    if (payment.status === ShippingFeePaymentStatus.SUCCEEDED) {
      this.assertPaidIntegrity(fee);
      return;
    }
    if (fee.status !== ShippingFeeTransactionStatus.PAYMENT_PENDING) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_STATE_CONFLICT',
        message: 'Shipping fee is no longer awaiting this online payment',
      });
    }
    const acceptedAt = payment.providerAcceptedAt ?? webhook.occurredAt;
    const paymentChanged = await tx.shippingFeePayment.updateMany({
      where: {
        id: payment.id,
        status: { in: [ShippingFeePaymentStatus.CREATING, ShippingFeePaymentStatus.PENDING] },
      },
      data: {
        status: ShippingFeePaymentStatus.SUCCEEDED,
        providerReference: webhook.providerReference,
        providerAcceptedAt: acceptedAt,
        succeededAt: webhook.occurredAt,
      },
    });
    const feeChanged = await tx.shippingFeeTransaction.updateMany({
      where: {
        id: fee.id,
        shipmentId: fee.shipmentId,
        payer: payment.payer,
        expectedAmount: payment.amount,
        status: ShippingFeeTransactionStatus.PAYMENT_PENDING,
        paidAmount: null,
        paidAt: null,
      },
      data: {
        status: ShippingFeeTransactionStatus.PAID,
        paidAmount: payment.amount,
        paidAt: webhook.occurredAt,
      },
    });
    if (paymentChanged.count !== 1 || feeChanged.count !== 1) this.concurrentModification();
    await this.auditWebhook(tx, payment, context, 'SHIPPING_FEE_ONLINE_PAID', {
      before: { feeStatus: fee.status, paymentStatus: payment.status },
      after: {
        feeStatus: ShippingFeeTransactionStatus.PAID,
        paymentStatus: ShippingFeePaymentStatus.SUCCEEDED,
        paidAmount: payment.amount,
        paidAt: webhook.occurredAt,
      },
    });
  }

  private async applyFailedWebhook(
    tx: Prisma.TransactionClient,
    payment: PaymentWithShipment,
    webhook: { providerReference: string; occurredAt: Date; failureCode: string | null },
    context: ClientContext,
  ): Promise<void> {
    const fee = payment.shippingFeeTransaction;
    if (payment.status === ShippingFeePaymentStatus.SUCCEEDED) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_TERMINAL_CONFLICT',
        message: 'A succeeded payment cannot later be changed to failed',
      });
    }
    if (payment.status === ShippingFeePaymentStatus.FAILED) return;
    if (fee.status !== ShippingFeeTransactionStatus.PAYMENT_PENDING) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_STATE_CONFLICT',
        message: 'Shipping fee is no longer awaiting this online payment',
      });
    }
    const failureCode = webhook.failureCode ?? 'PAYMENT_FAILED';
    const acceptedAt = payment.providerAcceptedAt ?? webhook.occurredAt;
    const paymentChanged = await tx.shippingFeePayment.updateMany({
      where: {
        id: payment.id,
        status: { in: [ShippingFeePaymentStatus.CREATING, ShippingFeePaymentStatus.PENDING] },
      },
      data: {
        status: ShippingFeePaymentStatus.FAILED,
        providerReference: webhook.providerReference,
        providerAcceptedAt: acceptedAt,
        failedAt: webhook.occurredAt,
        failureCode,
      },
    });
    const feeChanged = await tx.shippingFeeTransaction.updateMany({
      where: {
        id: fee.id,
        payer: payment.payer,
        expectedAmount: payment.amount,
        status: ShippingFeeTransactionStatus.PAYMENT_PENDING,
      },
      data: { status: ShippingFeeTransactionStatus.PENDING },
    });
    if (paymentChanged.count !== 1 || feeChanged.count !== 1) this.concurrentModification();
    await this.auditWebhook(tx, payment, context, 'SHIPPING_FEE_ONLINE_PAYMENT_FAILED', {
      before: { feeStatus: fee.status, paymentStatus: payment.status },
      after: {
        feeStatus: ShippingFeeTransactionStatus.PENDING,
        paymentStatus: ShippingFeePaymentStatus.FAILED,
        failureCode,
        failedAt: webhook.occurredAt,
      },
    });
  }

  private auditWebhook(
    tx: Prisma.TransactionClient,
    payment: PaymentWithShipment,
    context: ClientContext,
    action: string,
    change: { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue },
  ) {
    return tx.auditLog.create({
      data: {
        actorId: payment.initiatedById,
        actorRole: UserRole.CUSTOMER,
        action,
        entityType: 'ShippingFeePayment',
        entityId: payment.id,
        before: change.before,
        after: change.after,
        metadata: {
          source: 'PROVIDER_WEBHOOK',
          shipmentId: payment.shippingFeeTransaction.shipmentId,
          shippingFeeTransactionId: payment.shippingFeeTransactionId,
          reference: payment.reference,
          payer: payment.payer,
          amount: payment.amount,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }

  private availability(
    shipmentStatus: ShipmentStatus,
    feeStatus: ShippingFeeTransactionStatus,
    payer: ShippingFeePayer,
  ): { available: boolean; reason: string | null } {
    if (!this.gateway.enabled) return { available: false, reason: 'PAYMENT_PROVIDER_DISABLED' };
    if (feeStatus === ShippingFeeTransactionStatus.PAID) {
      return { available: false, reason: 'SHIPPING_FEE_ALREADY_PAID' };
    }
    if (feeStatus === ShippingFeeTransactionStatus.PAYMENT_PENDING) {
      return { available: false, reason: 'SHIPPING_FEE_PAYMENT_ALREADY_PENDING' };
    }
    if (feeStatus !== ShippingFeeTransactionStatus.PENDING) {
      return { available: false, reason: 'SHIPPING_FEE_PAYMENT_NOT_AVAILABLE' };
    }
    const due =
      (payer === ShippingFeePayer.SENDER && shipmentStatus === ShipmentStatus.PICKUP_IN_PROGRESS) ||
      (payer === ShippingFeePayer.RECEIVER && shipmentStatus === ShipmentStatus.OUT_FOR_DELIVERY);
    return {
      available: due,
      reason: due ? null : 'SHIPPING_FEE_PAYMENT_NOT_DUE',
    };
  }

  private assertFeeSnapshot(
    fee: {
      shipmentId: string;
      payer: ShippingFeePayer;
      expectedAmount: number;
    },
    shipment: {
      id: string;
      customerId: string;
      shippingFeePayer: ShippingFeePayer;
      totalFee: number;
    },
  ): void {
    if (
      fee.shipmentId !== shipment.id ||
      fee.payer !== shipment.shippingFeePayer ||
      fee.expectedAmount !== shipment.totalFee ||
      !Number.isSafeInteger(fee.expectedAmount) ||
      fee.expectedAmount <= 0
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_SNAPSHOT_INVALID',
        message: 'Shipping fee snapshot is inconsistent with its shipment',
      });
    }
  }

  private assertPaymentOwnership(payment: PaymentWithShipment): void {
    const fee = payment.shippingFeeTransaction;
    const shipment = fee.shipment;
    this.assertFeeSnapshot(fee, shipment);
    if (
      payment.shippingFeeTransactionId !== fee.id ||
      payment.initiatedById !== shipment.customerId ||
      payment.payer !== fee.payer ||
      payment.amount !== fee.expectedAmount ||
      payment.provider !== this.gateway.providerCode
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_OWNERSHIP_INVALID',
        message: 'Payment ownership is inconsistent with its shipping fee and shipment',
      });
    }
  }

  private assertPaidIntegrity(fee: PaymentWithShipment['shippingFeeTransaction']): void {
    if (
      fee.status !== ShippingFeeTransactionStatus.PAID ||
      fee.paidAmount !== fee.expectedAmount ||
      !fee.paidAt ||
      fee.collectedAmount !== null ||
      fee.remittedAmount !== null
    ) {
      throw new ConflictException({
        code: 'SHIPPING_FEE_PAYMENT_STATE_CONFLICT',
        message: 'Paid shipping fee data is inconsistent',
      });
    }
  }

  private async findOwnedPayment(
    paymentId: string,
    customerId: string,
  ): Promise<PaymentWithShipment> {
    const payment = await this.prisma.shippingFeePayment.findFirst({
      where: {
        id: paymentId,
        initiatedById: customerId,
        shippingFeeTransaction: { shipment: { customerId } },
      },
      include: paymentInclude,
    });
    if (!payment) this.paymentNotFound();
    this.assertPaymentOwnership(payment);
    return payment;
  }

  private toResponse(payment: PaymentWithShipment, checkoutUrl: string | null) {
    return {
      reference: payment.reference,
      amount: payment.amount,
      payer: payment.payer,
      status: payment.status,
      feeStatus: payment.shippingFeeTransaction.status,
      initiatedAt: payment.initiatedAt,
      succeededAt: payment.succeededAt,
      failedAt: payment.failedAt,
      failureCode: payment.failureCode,
      checkoutUrl,
      shipment: {
        id: payment.shippingFeeTransaction.shipment.id,
        trackingCode: payment.shippingFeeTransaction.shipment.trackingCode,
      },
    };
  }

  private assertCustomer(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException({
        code: 'SHIPPING_FEE_PAYMENT_CUSTOMER_REQUIRED',
        message: 'Only the Customer who owns the shipment can start or view this payment',
      });
    }
  }

  private paymentNotFound(): never {
    throw new NotFoundException({
      code: 'SHIPPING_FEE_PAYMENT_NOT_FOUND',
      message: 'Shipping-fee payment was not found',
    });
  }

  private providerUnavailable(): never {
    throw new ServiceUnavailableException({
      code: 'SHIPPING_FEE_PAYMENT_PROVIDER_UNAVAILABLE',
      message: 'Online payment is temporarily unavailable; retry with the same request',
    });
  }

  private concurrentModification(): never {
    throw new ConflictException({
      code: 'SHIPPING_FEE_PAYMENT_CONCURRENT_MODIFICATION',
      message: 'Payment changed concurrently; reload and try again',
    });
  }
}
