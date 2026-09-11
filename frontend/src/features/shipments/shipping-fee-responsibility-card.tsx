import { ShippingFeeStatusBadge } from '../../components/ui/status-badge';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import type { ShippingFeePayer } from './shipping-fee-payer';
import type { ShippingFeeTransaction } from './shipment-types';
import { shippingFeePayerLabel } from './shipping-fee-payer';

type ShippingFeeResponsibilityCardProps = {
  title?: string;
} & (
  | { transaction: ShippingFeeTransaction; payer?: never }
  | { transaction?: never; payer: ShippingFeePayer }
);

export function ShippingFeeResponsibilityCard({
  transaction,
  payer: previewPayer,
  title = 'Phí vận chuyển',
}: ShippingFeeResponsibilityCardProps) {
  const payer = transaction?.payer ?? (previewPayer as ShippingFeePayer);
  return (
    <section className="rounded-surface border border-border bg-surface p-5 shadow-surface">
      <h2 className="font-semibold text-ink">{title}</h2>
      {transaction ? (
        <div className="mt-3">
          <ShippingFeeStatusBadge status={transaction.status} />
        </div>
      ) : null}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Người thanh toán</dt>
          <dd className="mt-1 font-semibold text-ink">{shippingFeePayerLabel(payer)}</dd>
        </div>
        {transaction ? (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Số tiền phải thu</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">
              {vndFormatter.format(transaction.expectedAmount)}
            </dd>
          </div>
        ) : null}
        {transaction?.collectedAt ? (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Thu lúc</dt>
            <dd className="mt-1 font-semibold text-ink">
              {dateTimeFormatter.format(new Date(transaction.collectedAt))}
            </dd>
          </div>
        ) : null}
        {transaction?.remittedAt ? (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Bàn giao lúc</dt>
            <dd className="mt-1 font-semibold text-ink">
              {dateTimeFormatter.format(new Date(transaction.remittedAt))}
            </dd>
          </div>
        ) : null}
        {transaction?.settledAt ? (
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-muted-foreground">Đối soát hoàn tất lúc</dt>
            <dd className="mt-1 font-semibold text-ink">
              {dateTimeFormatter.format(new Date(transaction.settledAt))}
            </dd>
          </div>
        ) : null}
        {transaction?.paidAt ? (
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-muted-foreground">Thanh toán trực tuyến lúc</dt>
            <dd className="mt-1 font-semibold text-ink">
              {dateTimeFormatter.format(new Date(transaction.paidAt))}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Khoản này được quản lý riêng, không cộng vào hoặc thay đổi tiền thu hộ COD.
      </p>
    </section>
  );
}
