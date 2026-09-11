import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { failDelivery, getMyDeliveryAssignment } from './operations-api';
import type { DeliveryFailureReason } from './operations-types';

const reasons: Array<[DeliveryFailureReason, string]> = [
  ['RECIPIENT_UNAVAILABLE', 'Không liên hệ được người nhận'],
  ['RECIPIENT_REJECTED', 'Người nhận từ chối'],
  ['WRONG_ADDRESS', 'Sai địa chỉ'],
  ['INVALID_PHONE', 'Số điện thoại không hợp lệ'],
  ['ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ'],
  ['VEHICLE_ISSUE', 'Sự cố phương tiện'],
  ['WEATHER', 'Thời tiết không phù hợp'],
  ['OTHER', 'Lý do khác'],
];

export function FailedDeliveryPage() {
  const { assignmentId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<DeliveryFailureReason | ''>('');
  const [note, setNote] = useState('');
  const assignment = useQuery({
    queryKey: ['driver-delivery', assignmentId],
    queryFn: () => getMyDeliveryAssignment(assignmentId),
    enabled: Boolean(assignmentId),
  });
  const fail = useMutation({
    mutationFn: () => failDelivery({ assignmentId, reason: reason as DeliveryFailureReason, note: note.trim() || undefined }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['driver-delivery', assignmentId], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-delivery-history'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] }),
      ]);
      navigate(`/driver/deliveries/${assignmentId}`, { replace: true, state: { notice: 'Đã ghi nhận lần giao chưa thành công và thông báo cho Dispatcher.' } });
    },
  });
  if (assignment.isPending) return <AccountLayout><LoadingState label="Đang tải biểu mẫu giao thất bại" /></AccountLayout>;
  const eligible = assignment.data?.attempt?.status === 'OUT_FOR_DELIVERY';
  return (
    <AccountLayout>
      <main className="mx-auto max-w-2xl">
        <PageHeader
          actions={<Link className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink" to={`/driver/deliveries/${assignmentId}`}>Hủy và quay lại</Link>}
          description="Mỗi lần giao thất bại tạo một DeliveryAttempt riêng; không ghi đè lịch sử."
          eyebrow="Driver · Delivery"
          title="Báo giao thất bại"
        />
        {assignment.isError ? (
          <div className="mt-6"><ErrorState message={getApiErrorMessage(assignment.error)} onRetry={() => void assignment.refetch()} title="Không thể tải nhiệm vụ" /></div>
        ) : !eligible ? (
          <div className="mt-6"><ErrorState message="Nhiệm vụ không ở trạng thái đang giao. Hãy quay lại chi tiết để tải trạng thái mới nhất." title="Không thể ghi nhận thất bại" /></div>
        ) : (
          <form className="mt-6 space-y-5 rounded-surface border border-border bg-surface p-5 shadow-surface" onSubmit={(event) => { event.preventDefault(); if (reason) fail.mutate(); }}>
            {fail.isError ? <ErrorSummary message={getApiErrorMessage(fail.error)} /> : null}
            <label className="block text-sm font-semibold text-ink">Nguyên nhân <span aria-hidden="true" className="text-danger">*</span><Select className="mt-2" onChange={(event) => setReason(event.target.value as DeliveryFailureReason)} required value={reason}><option value="">Chọn nguyên nhân</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
            <div><label className="mb-2 block text-sm font-semibold text-ink" htmlFor="failure-note">Ghi chú (tùy chọn)</label><textarea className="focus-ring min-h-32 w-full rounded-control border border-border bg-surface p-3.5 text-base text-ink" id="failure-note" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} /></div>
            <Button className="w-full" disabled={!reason} loading={fail.isPending} size="lg" type="submit" variant="danger">Xác nhận giao thất bại</Button>
          </form>
        )}
      </main>
    </AccountLayout>
  );
}
