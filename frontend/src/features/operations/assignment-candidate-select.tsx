import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/ui/error-state';
import { SelectField } from '../../components/ui/select-field';
import { getApiErrorMessage } from '../../services/api-error';
import { formatCandidateRouteMetric } from '../../utils/route-metric';
import { listDeliveryCandidates, listPickupCandidates } from './operations-api';

interface AssignmentCandidateSelectProps {
  disabled?: boolean;
  kind: 'PICKUP' | 'DELIVERY';
  label: string;
  onChange: (driverId: string) => void;
  selectedDriverId: string;
  shipmentId: string;
}

export function AssignmentCandidateSelect({
  disabled,
  kind,
  label,
  onChange,
  selectedDriverId,
  shipmentId,
}: AssignmentCandidateSelectProps) {
  const candidates = useQuery({
    queryKey: ['assignment-candidates', kind, shipmentId],
    queryFn: () =>
      kind === 'PICKUP' ? listPickupCandidates(shipmentId) : listDeliveryCandidates(shipmentId),
    refetchInterval: 5_000,
  });
  const items = candidates.data?.candidates ?? [];
  const noCurrentLocation = candidates.data?.exclusions.noCurrentLocation ?? 0;
  const missingCapability = candidates.data?.exclusions.missingCapability ?? 0;
  const unavailableArea =
    (candidates.data?.exclusions.noOperatingWarehouse ?? 0) +
    (candidates.data?.exclusions.outsideOperatingArea ?? 0);

  if (candidates.isError) {
    return (
      <ErrorState
        compact
        message={getApiErrorMessage(candidates.error)}
        onRetry={() => void candidates.refetch()}
        title="Không thể xếp hạng ứng viên"
      />
    );
  }

  return (
    <div className="space-y-2">
      <SelectField
        disabled={disabled || candidates.isPending || items.length === 0}
        helperText={candidates.data?.distanceNotice ?? 'Đang đọc GPS hiện tại từ backend.'}
        id={`${kind.toLowerCase()}-candidate-${shipmentId}`}
        label={label}
        onChange={(event) => onChange(event.target.value)}
        value={selectedDriverId}
      >
        <option value="">
          {candidates.isPending
            ? 'Đang xếp hạng theo vị trí...'
            : items.length
              ? 'Chọn tài xế theo khoảng cách ước tính'
              : 'Không có tài xế đủ điều kiện'}
        </option>
        {items.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.fullName} · {formatCandidateRouteMetric(candidate)} ·{' '}
            {candidate.employeeCode}
          </option>
        ))}
      </SelectField>
      {candidates.data ? (
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground" role="status">
          {items.length} ứng viên phù hợp khu vực có GPS hiện tại
          {noCurrentLocation > 0 ? ` · ${noCurrentLocation} thiếu hoặc stale GPS` : ''}
          {unavailableArea > 0 ? ` · ${unavailableArea} không phù hợp khu vực` : ''}
          {missingCapability > 0 ? ` · ${missingCapability} không có capability ${kind}` : ''}.
        </p>
      ) : null}
    </div>
  );
}
