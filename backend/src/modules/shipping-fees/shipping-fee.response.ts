import type {
  ShippingFeePayer,
  ShippingFeeTransaction,
  ShippingFeeTransactionStatus,
} from '../../generated/prisma/client.js';

export interface ShippingFeeTransactionResponse {
  id: string;
  payer: ShippingFeePayer;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  paidAmount: number | null;
  status: ShippingFeeTransactionStatus;
  collectedAt: Date | null;
  remittedAt: Date | null;
  settledAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
}

export function toShippingFeeTransactionResponse(
  transaction: ShippingFeeTransaction,
): ShippingFeeTransactionResponse {
  return {
    id: transaction.id,
    payer: transaction.payer,
    expectedAmount: transaction.expectedAmount,
    collectedAmount: transaction.collectedAmount,
    remittedAmount: transaction.remittedAmount,
    paidAmount: transaction.paidAmount,
    status: transaction.status,
    collectedAt: transaction.collectedAt,
    remittedAt: transaction.remittedAt,
    settledAt: transaction.settledAt,
    paidAt: transaction.paidAt,
    cancelledAt: transaction.cancelledAt,
  };
}
