import type { PricingBreakdown } from '../shipments/shipment-types';
import { vndFormatter } from '../../utils/format';

export function PriceBreakdown({ pricing }: { pricing: PricingBreakdown }) {
  const rows = [
    ['Phí cơ bản', pricing.baseFee],
    ['Phí khối lượng', pricing.weightFee],
    ['Phí COD', pricing.codFee],
    ['Phí khoảng cách', pricing.distanceFee],
    ['Phụ phí', pricing.surcharge],
    ['Giảm giá', -pricing.discount],
  ] as const;

  return (
    <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6" aria-labelledby="price-breakdown-title">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink" id="price-breakdown-title">Chi tiết phí</h2>
        <span className="shrink-0 rounded-full border border-border-strong bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">Bảng giá v{pricing.configVersion}</span>
      </div>
      <dl className="mt-5 space-y-3">
        {rows.map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 text-sm" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums text-ink">{vndFormatter.format(value)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <dt className="font-semibold text-ink">Tổng phí</dt>
          <dd className="text-2xl font-bold tabular-nums text-primary">{vndFormatter.format(pricing.totalFee)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">Phí chính thức luôn được backend tính lại khi tạo vận đơn.</p>
    </section>
  );
}
