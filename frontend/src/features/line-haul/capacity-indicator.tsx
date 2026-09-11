import { formatCapacityWeight } from './line-haul-model';

interface CapacityIndicatorProps {
  capacityUtilizationPercent: number | null;
  manifestWeightGrams: number;
  remainingCapacityWeightGrams: number | null;
  vehicleCapacityWeightGrams: number | null;
  compact?: boolean;
}

export function CapacityIndicator({
  capacityUtilizationPercent,
  compact = false,
  manifestWeightGrams,
  remainingCapacityWeightGrams,
  vehicleCapacityWeightGrams,
}: CapacityIndicatorProps) {
  if (
    vehicleCapacityWeightGrams === null ||
    remainingCapacityWeightGrams === null ||
    capacityUtilizationPercent === null
  ) {
    return (
      <div
        className="rounded-control border border-danger/30 bg-danger-soft p-4 text-danger"
        role="status"
      >
        <p className="text-sm font-bold">Chưa cấu hình sức tải</p>
        <p className="mt-1 text-sm leading-5">Xe chưa thể dùng cho chuyến vận hành mới.</p>
      </div>
    );
  }

  const overloaded = remainingCapacityWeightGrams < 0;
  const full = !overloaded && remainingCapacityWeightGrams === 0;
  // 80% is presentation-only; backend overload decisions compare integer grams.
  const nearFull = !overloaded && !full && capacityUtilizationPercent >= 80;
  const label = overloaded ? 'Quá tải' : full ? 'Đầy tải' : nearFull ? 'Gần đầy' : 'Còn sức tải';
  const tone = overloaded
    ? 'border-danger/30 bg-danger-soft text-danger'
    : full || nearFull
      ? 'border-warning/30 bg-warning-soft text-warning'
      : 'border-success/30 bg-success-soft text-success';
  const barTone = overloaded ? 'bg-danger' : full || nearFull ? 'bg-warning' : 'bg-success';
  const progress = Math.min(100, Math.max(0, capacityUtilizationPercent));

  return (
    <div
      aria-live="polite"
      className={`rounded-control border ${compact ? 'p-3' : 'p-4'} ${tone}`}
      role="status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold">{label}</p>
        <p className="text-sm font-bold tabular-nums">
          {formatCapacityWeight(manifestWeightGrams)} /{' '}
          {formatCapacityWeight(vehicleCapacityWeightGrams)}
        </p>
      </div>
      <div
        aria-label="Mức sử dụng sức tải xe"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="mt-3 h-2 overflow-hidden rounded-full bg-white/70"
        role="progressbar"
      >
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-sm font-semibold tabular-nums">
        {capacityUtilizationPercent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% tải ·{' '}
        {overloaded
          ? `Vượt ${formatCapacityWeight(Math.abs(remainingCapacityWeightGrams))}`
          : `Còn ${formatCapacityWeight(remainingCapacityWeightGrams)}`}
      </p>
    </div>
  );
}
