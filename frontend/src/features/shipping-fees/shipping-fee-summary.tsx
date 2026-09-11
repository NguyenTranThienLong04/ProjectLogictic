import { ShippingFeeStatusBadge } from '../../components/ui/status-badge';
import { vndFormatter } from '../../utils/format';
import type { ShippingFeeSummary } from './shipping-fee-api';

export function ShippingFeeSummaryCards({ summary }: { summary: ShippingFeeSummary[] }) {
  return (
    <section
      aria-label="Tổng tiền phí vận chuyển theo trạng thái"
      className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {summary.map((item) => (
        <article
          className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface"
          key={item.status}
        >
          <ShippingFeeStatusBadge status={item.status} />
          <p className="mt-3 text-lg font-bold tabular-nums tracking-tight text-ink">
            {vndFormatter.format(item.totalAmount)}
          </p>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">{item.count} giao dịch</p>
        </article>
      ))}
    </section>
  );
}
