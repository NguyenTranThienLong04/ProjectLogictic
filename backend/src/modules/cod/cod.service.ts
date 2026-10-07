import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ListCodDto } from './dto/list-cod.dto.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import type {
  CodReasonDto,
  CodVersionDto,
  CreatePayoutDto,
  SendPayoutDto,
  SubmitRemittanceDto,
} from './dto/cod-commands.dto.js';

// Customer reads omit internal notes and staff identities.
const customerPayoutSelect = {
  id: true,
  amount: true,
  method: true,
  reference: true,
  status: true,
  version: true,
  createdAt: true,
  sentAt: true,
  customerConfirmedAt: true,
  disputedAt: true,
  disputeReason: true,
} satisfies Prisma.CODPayoutSelect;

@Injectable()
export class CodService {
  constructor(private readonly prisma: PrismaService) {}

  async remit(
    actor: AuthenticatedUser,
    shipmentId: string,
    dto: SubmitRemittanceDto,
    context: ClientContext,
  ) {
    this.requireRole(actor, UserRole.DRIVER);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.cODTransaction.findUnique({ where: { shipmentId } });
      if (!found) throw this.notFound();
      const cod = await this.lock(tx, found.id);
      const driver = await tx.driverProfile.findUnique({ where: { userId: actor.id } });
      if (!driver || cod.collectedByDriverId !== driver.id) throw this.notFound();
      this.checkAmount(cod, dto.amount);
      const existing = await tx.cODRemittance.findUnique({
        where: {
          codTransactionId_clientRequestId: {
            codTransactionId: cod.id,
            clientRequestId: dto.clientRequestId,
          },
        },
      });
      if (existing) {
        if (
          existing.amount !== dto.amount ||
          existing.submittedByDriverId !== driver.id ||
          existing.note !== (dto.note || null)
        )
          throw this.conflict('COD_RETRY_CONFLICT', 'Yêu cầu đã được sử dụng với nội dung khác.');
        return existing;
      }
      if (cod.status !== 'COLLECTED') throw this.invalidState();
      if (
        await tx.cODRemittance.findFirst({ where: { codTransactionId: cod.id, status: 'PENDING' } })
      )
        throw this.conflict('COD_HANDOVER_PENDING', 'Khoản COD đang chờ công ty xác nhận.');
      const remittance = await tx.cODRemittance.create({
        data: {
          codTransactionId: cod.id,
          submittedByDriverId: driver.id,
          amount: dto.amount,
          clientRequestId: dto.clientRequestId,
          note: dto.note || null,
        },
      });
      await this.audit(
        tx,
        actor,
        context,
        'COD_HANDOVER_SUBMITTED',
        'CODRemittance',
        remittance.id,
        null,
        { status: 'PENDING', amount: dto.amount, codTransactionId: cod.id },
      );
      return remittance;
    });
  }

  async reviewRemittance(
    actor: AuthenticatedUser,
    id: string,
    dto: CodVersionDto | CodReasonDto,
    confirm: boolean,
    context: ClientContext,
  ) {
    this.requireRole(actor, UserRole.ADMIN);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.cODRemittance.findUnique({ where: { id } });
      if (!found) throw this.notFound();
      const cod = await this.lock(tx, found.codTransactionId);
      const row = await tx.cODRemittance.findUniqueOrThrow({ where: { id } });
      const next = confirm ? 'CONFIRMED' : 'REJECTED';
      const reason = 'reason' in dto ? dto.reason.trim() : null;
      if (!confirm && !reason) throw this.conflict('COD_REASON_REQUIRED', 'Cần lý do từ chối.');
      if (
        row.status === next &&
        row.version === dto.expectedVersion + 1 &&
        row.reviewedByAdminId === actor.id &&
        row.rejectionReason === reason
      )
        return row;
      if (row.status !== 'PENDING' || cod.status !== 'COLLECTED') throw this.invalidState();
      this.checkVersion(row.version, dto.expectedVersion);
      this.checkAmount(cod, row.amount);
      const now = new Date();
      const changed = await tx.cODRemittance.updateMany({
        where: { id, status: 'PENDING', version: dto.expectedVersion },
        data: {
          status: next,
          reviewedByAdminId: actor.id,
          reviewedAt: now,
          rejectionReason: reason,
          version: { increment: 1 },
        },
      });
      this.checkChanged(changed.count);
      if (confirm) {
        this.checkChanged(
          (
            await tx.cODTransaction.updateMany({
              where: { id: cod.id, status: 'COLLECTED', version: cod.version },
              data: {
                status: 'REMITTED',
                remittedAmount: row.amount,
                remittedAt: now,
                version: { increment: 1 },
              },
            })
          ).count,
        );
        await this.audit(
          tx,
          actor,
          context,
          'COD_REMITTED',
          'CODTransaction',
          cod.id,
          { status: cod.status },
          { status: 'REMITTED', amount: row.amount, remittanceId: id },
        );
      }
      await this.audit(
        tx,
        actor,
        context,
        confirm ? 'COD_HANDOVER_CONFIRMED' : 'COD_HANDOVER_REJECTED',
        'CODRemittance',
        id,
        { status: row.status, version: row.version },
        { status: next, reason, amount: row.amount },
      );
      return tx.cODRemittance.findUniqueOrThrow({ where: { id } });
    });
  }

  async settle(actor: AuthenticatedUser, id: string, context: ClientContext) {
    this.requireRole(actor, UserRole.ADMIN);
    return this.prisma.$transaction(async (tx) => {
      const cod = await this.lock(tx, id);
      this.checkAmount(cod, cod.remittedAmount);
      if (cod.status === 'SETTLED') return cod;
      if (cod.status !== 'REMITTED') throw this.invalidState();
      this.checkChanged(
        (
          await tx.cODTransaction.updateMany({
            where: {
              id,
              status: 'REMITTED',
              version: cod.version,
              collectedAmount: cod.expectedAmount,
              remittedAmount: cod.expectedAmount,
            },
            data: { status: 'SETTLED', settledAt: new Date(), version: { increment: 1 } },
          })
        ).count,
      );
      await this.audit(
        tx,
        actor,
        context,
        'COD_SETTLED',
        'CODTransaction',
        id,
        { status: cod.status },
        { status: 'SETTLED', amount: cod.expectedAmount },
      );
      return tx.cODTransaction.findUniqueOrThrow({ where: { id } });
    });
  }

  async createPayout(
    actor: AuthenticatedUser,
    codId: string,
    dto: CreatePayoutDto,
    context: ClientContext,
  ) {
    this.requireRole(actor, UserRole.ADMIN);
    return this.prisma.$transaction(async (tx) => {
      const cod = await this.lock(tx, codId);
      if (cod.status !== 'SETTLED') throw this.invalidState();
      this.checkAmount(cod, dto.amount);
      this.checkAmount(cod, cod.remittedAmount);
      const reference = dto.reference?.trim() || null;
      if (!reference)
        throw this.conflict(
          'COD_REFERENCE_REQUIRED',
          'Cần mã chuyển khoản hoặc mã biên nhận tiền mặt.',
        );
      const existing = await tx.cODPayout.findUnique({ where: { codTransactionId: codId } });
      if (existing) {
        if (
          existing.amount !== dto.amount ||
          existing.method !== dto.method ||
          existing.reference !== reference ||
          existing.note !== (dto.note || null) ||
          existing.createdByAdminId !== actor.id
        )
          throw this.conflict('COD_RETRY_CONFLICT', 'COD đã có khoản chi trả với nội dung khác.');
        return existing;
      }
      const shipment = await tx.shipment.findUniqueOrThrow({
        where: { id: cod.shipmentId },
        select: { customerId: true },
      });
      const payout = await tx.cODPayout.create({
        data: {
          codTransactionId: codId,
          customerId: shipment.customerId,
          amount: dto.amount,
          method: dto.method,
          reference,
          note: dto.note || null,
          createdByAdminId: actor.id,
        },
      });
      await this.audit(tx, actor, context, 'COD_PAYOUT_CREATED', 'CODPayout', payout.id, null, {
        status: 'PENDING',
        amount: dto.amount,
        method: dto.method,
        reference,
        codTransactionId: codId,
        customerId: shipment.customerId,
      });
      return payout;
    });
  }

  async sendPayout(
    actor: AuthenticatedUser,
    id: string,
    dto: SendPayoutDto,
    context: ClientContext,
  ) {
    this.requireRole(actor, UserRole.ADMIN);
    return this.prisma.$transaction(async (tx) => {
      const { cod, payout } = await this.lockPayout(tx, id);
      if (cod.status !== 'SETTLED') throw this.invalidState();
      this.checkAmount(cod, payout.amount);
      if (!dto.reference.trim() || payout.reference !== dto.reference.trim())
        throw this.conflict(
          'COD_REFERENCE_MISMATCH',
          'Mã chứng từ phải khớp khoản chi trả đã tạo.',
        );
      if (payout.sentAt && payout.sentByAdminId === actor.id && dto.expectedVersion === 0)
        return payout;
      if (payout.status !== 'PENDING') throw this.invalidState();
      this.checkVersion(payout.version, dto.expectedVersion);
      this.checkChanged(
        (
          await tx.cODPayout.updateMany({
            where: { id, status: 'PENDING', version: dto.expectedVersion },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              sentByAdminId: actor.id,
              version: { increment: 1 },
            },
          })
        ).count,
      );
      await this.audit(
        tx,
        actor,
        context,
        'COD_PAYOUT_SENT',
        'CODPayout',
        id,
        { status: 'PENDING' },
        { status: 'SENT', reference: payout.reference, amount: payout.amount },
      );
      return tx.cODPayout.findUniqueOrThrow({ where: { id } });
    });
  }

  async acknowledgePayout(
    actor: AuthenticatedUser,
    id: string,
    dto: CodVersionDto | CodReasonDto,
    received: boolean,
    context: ClientContext,
  ) {
    this.requireRole(actor, UserRole.CUSTOMER);
    return this.prisma.$transaction(async (tx) => {
      const { cod, payout } = await this.lockPayout(tx, id);
      const owned = await tx.shipment.findFirst({
        where: { id: cod.shipmentId, customerId: actor.id },
        select: { id: true },
      });
      if (payout.customerId !== actor.id || !owned) throw this.notFound();
      const next = received ? 'PAID_OUT' : 'DISPUTED';
      const reason = 'reason' in dto ? dto.reason.trim() : null;
      if (!received && !reason)
        throw this.conflict('COD_REASON_REQUIRED', 'Cần mô tả vấn đề với khoản chi trả.');
      if (
        payout.status === next &&
        payout.version === dto.expectedVersion + 1 &&
        payout.disputeReason === reason
      )
        return tx.cODPayout.findUniqueOrThrow({ where: { id }, select: customerPayoutSelect });
      if (cod.status !== 'SETTLED' || payout.status !== 'SENT') throw this.invalidState();
      this.checkAmount(cod, payout.amount);
      this.checkVersion(payout.version, dto.expectedVersion);
      const now = new Date();
      this.checkChanged(
        (
          await tx.cODPayout.updateMany({
            where: { id, customerId: actor.id, status: 'SENT', version: dto.expectedVersion },
            data: {
              status: next,
              customerConfirmedAt: received ? now : null,
              disputedAt: received ? null : now,
              disputeReason: reason,
              version: { increment: 1 },
            },
          })
        ).count,
      );
      await this.audit(
        tx,
        actor,
        context,
        received ? 'COD_PAYOUT_RECEIVED' : 'COD_PAYOUT_DISPUTED',
        'CODPayout',
        id,
        { status: 'SENT' },
        { status: next, amount: payout.amount, reason },
      );
      return tx.cODPayout.findUniqueOrThrow({ where: { id }, select: customerPayoutSelect });
    });
  }

  async customerDetail(actor: AuthenticatedUser, shipmentId: string) {
    this.requireRole(actor, UserRole.CUSTOMER);
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, customerId: actor.id },
      select: {
        id: true,
        codTransaction: {
          select: {
            status: true,
            expectedAmount: true,
            collectedAt: true,
            remittedAt: true,
            settledAt: true,
            remittances: {
              orderBy: { submittedAt: 'asc' },
              select: { id: true, status: true, submittedAt: true, reviewedAt: true },
            },
            payout: { select: customerPayoutSelect },
          },
        },
      },
    });
    if (!shipment) throw this.notFound();
    return shipment.codTransaction;
  }

  async mine(actor: AuthenticatedUser, query = new ListCodDto()) {
    this.requireRole(actor, UserRole.DRIVER);
    const driver = await this.prisma.driverProfile.findUnique({ where: { userId: actor.id } });
    if (!driver) throw this.notFound();
    if (query.payoutStatus) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Payout filters require Admin access',
      });
    }
    return this.list(query, { collectedByDriverId: driver.id }, false);
  }

  async dashboard(query = new ListCodDto()) {
    return this.list(query, {}, true);
  }

  private async list(
    query: ListCodDto,
    scope: Prisma.CODTransactionWhereInput,
    includePayout: boolean,
  ) {
    const { page, limit, status, payoutStatus } = query;
    const where: Prisma.CODTransactionWhereInput = {
      ...scope,
      ...(status ? { status } : {}),
      ...(payoutStatus
        ? { payout: payoutStatus === 'NONE' ? { is: null } : { is: { status: payoutStatus } } }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const [items, total, summary] = await Promise.all([
          tx.cODTransaction.findMany({
            where,
            include: {
              shipment: {
                select: { trackingCode: true, customer: { select: { fullName: true } } },
              },
              collectedByDriver: { select: { user: { select: { fullName: true } } } },
              remittances: { orderBy: { submittedAt: 'desc' } },
              payout: includePayout,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          tx.cODTransaction.count({ where }),
          tx.cODTransaction.groupBy({
            // Operational totals cover every scoped record, independent of page/list filters.
            where: scope,
            by: ['status'],
            orderBy: { status: 'asc' },
            _sum: { expectedAmount: true },
            _count: { _all: true },
          }),
        ]);
        return { items, summary, page, limit, total, totalPages: Math.ceil(total / limit) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async lock(tx: Prisma.TransactionClient, id: string) {
    // Every child command locks its parent before reading mutable state.
    await tx.$queryRaw`SELECT id FROM "CODTransaction" WHERE id = ${id}::uuid FOR UPDATE`;
    const cod = await tx.cODTransaction.findUnique({ where: { id } });
    if (!cod) throw this.notFound();
    return cod;
  }

  private async lockPayout(tx: Prisma.TransactionClient, id: string) {
    const found = await tx.cODPayout.findUnique({ where: { id } });
    if (!found) throw this.notFound();
    const cod = await this.lock(tx, found.codTransactionId);
    return { cod, payout: await tx.cODPayout.findUniqueOrThrow({ where: { id } }) };
  }

  private checkAmount(
    cod: { expectedAmount: number; collectedAmount: number | null },
    amount: number | null,
  ) {
    if (
      !Number.isSafeInteger(amount) ||
      amount === null ||
      amount <= 0 ||
      amount !== cod.expectedAmount ||
      cod.collectedAmount !== cod.expectedAmount
    )
      throw this.conflict('COD_AMOUNT_MISMATCH', 'Số tiền phải khớp đầy đủ COD đã thu.');
  }
  private requireRole(actor: AuthenticatedUser, role: UserRole) {
    if (actor.role !== role)
      throw new ForbiddenException({
        code: 'COD_ROLE_FORBIDDEN',
        message: 'Bạn không có quyền thực hiện thao tác này.',
      });
  }
  private checkVersion(actual: number, expected: number) {
    if (actual !== expected)
      throw this.conflict(
        'COD_CONCURRENT_MODIFICATION',
        'Dữ liệu đã thay đổi. Tải lại trước khi tiếp tục.',
      );
  }
  private checkChanged(count: number) {
    if (count !== 1)
      throw this.conflict(
        'COD_CONCURRENT_MODIFICATION',
        'Dữ liệu đã thay đổi. Tải lại trước khi tiếp tục.',
      );
  }
  private invalidState() {
    return this.conflict('COD_STATE_INVALID', 'Trạng thái COD không cho phép thao tác này.');
  }
  private notFound() {
    return new NotFoundException({
      code: 'COD_TRANSACTION_NOT_FOUND',
      message: 'Không tìm thấy giao dịch COD thuộc quyền truy cập.',
    });
  }
  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    context: ClientContext,
    action: string,
    entityType: string,
    entityId: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action,
        entityType,
        entityId,
        before: before ?? Prisma.JsonNull,
        after,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  }
}
