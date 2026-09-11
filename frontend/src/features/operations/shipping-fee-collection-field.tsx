import { Input } from '../../components/ui/input';
import { ShippingFeeStatusBadge } from '../../components/ui/status-badge';
import { vndFormatter } from '../../utils/format';
import type { ShippingFeeTransaction } from '../shipments/shipment-types';
import { shippingFeePayerLabel } from '../shipments/shipping-fee-payer';
import { parseShippingFeeAmount } from './shipping-fee-collection';

interface ShippingFeeCollectionFieldProps {
  id: string;
  transaction: ShippingFeeTransaction;
  value: string;
  touched: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
}

export function ShippingFeeCollectionField({
  id,
  transaction,
  value,
  touched,
  onBlur,
  onChange,
}: ShippingFeeCollectionFieldProps) {
  const parsed = parseShippingFeeAmount(value);
  const invalid = touched && parsed !== transaction.expectedAmount;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <fieldset className="rounded-surface border border-indigo-200 bg-indigo-50 p-4">
      <legend className="px-1 text-base font-semibold text-ink">Thu phí vận chuyển</legend>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Thu từ {shippingFeePayerLabel(transaction.payer).toLocaleLowerCase('vi-VN')}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink">
            {vndFormatter.format(transaction.expectedAmount)}
          </p>
        </div>
        <ShippingFeeStatusBadge status={transaction.status} />
      </div>
      <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={id}>
        Số tiền phí vận chuyển đã thu (VND)
        <span aria-hidden="true" className="text-danger"> *</span>
      </label>
      <Input
        aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
        aria-invalid={invalid}
        className="mt-2 tabular-nums"
        id={id}
        inputMode="numeric"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        pattern="[0-9]*"
        required
        value={value}
      />
      <p className="mt-2 text-sm leading-6 text-muted-foreground" id={helpId}>
        Đếm tiền thực nhận và nhập đúng số nguyên VND hiển thị phía trên.
      </p>
      {invalid ? (
        <p aria-live="polite" className="mt-2 text-sm font-medium text-danger" id={errorId}>
          Số tiền phải đúng {vndFormatter.format(transaction.expectedAmount)}.
        </p>
      ) : null}
    </fieldset>
  );
}
