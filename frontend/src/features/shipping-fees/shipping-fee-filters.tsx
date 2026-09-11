import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import type { ShippingFeePayer, ShippingFeeTransactionStatus } from '../shipments/shipment-types';

const statuses: Array<{ value: ShippingFeeTransactionStatus; label: string }> = [
  { value: 'PENDING', label: 'Chờ thu' },
  { value: 'PAYMENT_PENDING', label: 'Chờ thanh toán trực tuyến' },
  { value: 'PAID', label: 'Đã thanh toán trực tuyến' },
  { value: 'COLLECTED', label: 'Đã thu' },
  { value: 'REMITTED', label: 'Đã bàn giao' },
  { value: 'SETTLED', label: 'Đã đối soát' },
  { value: 'DISPUTED', label: 'Đang tranh chấp' },
  { value: 'CANCELLED', label: 'Đã hủy thu' },
];

interface ShippingFeeFiltersProps {
  idPrefix: string;
  searchInput: string;
  status?: ShippingFeeTransactionStatus;
  payer?: ShippingFeePayer;
  disabled?: boolean;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  onStatusChange: (value?: ShippingFeeTransactionStatus) => void;
  onPayerChange: (value?: ShippingFeePayer) => void;
}

export function ShippingFeeFilters({
  disabled = false,
  idPrefix,
  onPayerChange,
  onSearchInputChange,
  onSearchSubmit,
  onStatusChange,
  payer,
  searchInput,
  status,
}: ShippingFeeFiltersProps) {
  const statusId = `${idPrefix}-status`;
  const payerId = `${idPrefix}-payer`;
  return (
    <SearchFilter
      disabled={disabled}
      label="Tìm vận đơn hoặc tài xế"
      onChange={onSearchInputChange}
      onClear={() => {
        onSearchInputChange('');
        onSearchSubmit('');
      }}
      onSubmit={() => onSearchSubmit(searchInput)}
      placeholder="Mã vận đơn, tên, email hoặc mã tài xế"
      value={searchInput}
    >
      <div className="min-w-40 flex-1 sm:flex-none">
        <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={statusId}>
          Trạng thái
        </label>
        <Select
          disabled={disabled}
          id={statusId}
          onChange={(event) =>
            onStatusChange(
              (event.target.value || undefined) as ShippingFeeTransactionStatus | undefined,
            )
          }
          value={status ?? ''}
        >
          <option value="">Tất cả trạng thái</option>
          {statuses.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-40 flex-1 sm:flex-none">
        <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={payerId}>
          Người trả phí
        </label>
        <Select
          disabled={disabled}
          id={payerId}
          onChange={(event) =>
            onPayerChange((event.target.value || undefined) as ShippingFeePayer | undefined)
          }
          value={payer ?? ''}
        >
          <option value="">Tất cả người trả</option>
          <option value="SENDER">Người gửi</option>
          <option value="RECEIVER">Người nhận</option>
        </Select>
      </div>
    </SearchFilter>
  );
}
