import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { Input } from '../../components/ui/input';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { completeDelivery, getMyDeliveryAssignment } from './operations-api';
import { parseShippingFeeAmount } from './shipping-fee-collection';
import { ShippingFeeCollectionField } from './shipping-fee-collection-field';

export function ProofOfDeliveryPage() {
  const { assignmentId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [receiverName, setReceiverName] = useState('');
  const [note, setNote] = useState('');
  const [shippingFeeAmount, setShippingFeeAmount] = useState('');
  const [shippingFeeTouched, setShippingFeeTouched] = useState(false);
  const assignment = useQuery({
    queryKey: ['driver-delivery', assignmentId],
    queryFn: () => getMyDeliveryAssignment(assignmentId),
    enabled: Boolean(assignmentId),
  });
  const complete = useMutation({
    mutationFn: () =>
      completeDelivery({
        assignmentId,
        receiverName: receiverName.trim(),
        note: note.trim() || undefined,
        shippingFeeAmount: assignment.data?.availableActions.collectShippingFee
          ? parseShippingFeeAmount(shippingFeeAmount)
          : undefined,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['driver-delivery', assignmentId], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-delivery-history'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] }),
      ]);
      navigate(`/driver/deliveries/${assignmentId}`, {
        replace: true,
        state: {
          notice:
            updated.shippingFee.status === 'COLLECTED' && updated.shippingFee.payer === 'RECEIVER'
              ? 'Đã hoàn tất giao hàng, thu phí vận chuyển và ghi nhận Proof of Delivery.'
              : 'Đã hoàn tất giao hàng và ghi nhận Proof of Delivery.',
        },
      });
    },
  });
  if (assignment.isPending) return <AccountLayout><LoadingState label="Đang tải biểu mẫu POD" /></AccountLayout>;
  const eligible = assignment.data?.attempt?.status === 'OUT_FOR_DELIVERY';
  return (
    <AccountLayout>
      <main className="mx-auto max-w-2xl">
        <PageHeader
          actions={<Link className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink" to={`/driver/deliveries/${assignmentId}`}>Hủy và quay lại</Link>}
          description="Tên người nhận là bắt buộc; backend tạo proof và transition giao hàng trong cùng transaction."
          eyebrow="Driver · Delivery"
          title="Proof of Delivery"
        />
        {assignment.isError ? (
          <div className="mt-6"><ErrorState message={getApiErrorMessage(assignment.error)} onRetry={() => void assignment.refetch()} title="Không thể tải nhiệm vụ" /></div>
        ) : !eligible ? (
          <div className="mt-6"><ErrorState message="Nhiệm vụ không ở trạng thái đang giao. Hãy quay lại chi tiết để tải trạng thái mới nhất." title="Không thể ghi nhận POD" /></div>
        ) : (
          <form
            className="mt-6 space-y-5 rounded-surface border border-border bg-surface p-5 shadow-surface"
            onSubmit={(event) => {
              event.preventDefault();
              setShippingFeeTouched(true);
              if (
                assignment.data.availableActions.collectShippingFee &&
                parseShippingFeeAmount(shippingFeeAmount) !== assignment.data.shippingFee.expectedAmount
              ) {
                return;
              }
              complete.mutate();
            }}
          >
            {complete.isError ? <ErrorSummary message={getApiErrorMessage(complete.error)} /> : null}
            {assignment.data.availableActions.collectShippingFee ? (
              <ShippingFeeCollectionField
                id="delivery-shipping-fee-amount"
                onBlur={() => setShippingFeeTouched(true)}
                onChange={(value) => {
                  setShippingFeeAmount(value);
                  if (shippingFeeTouched) setShippingFeeTouched(false);
                }}
                touched={shippingFeeTouched}
                transaction={assignment.data.shippingFee}
                value={shippingFeeAmount}
              />
            ) : null}
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="pod-receiver-name">Tên người nhận <span aria-hidden="true" className="text-danger">*</span></label>
              <Input id="pod-receiver-name" maxLength={100} onChange={(event) => setReceiverName(event.target.value)} required value={receiverName} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="pod-note">Ghi chú (tùy chọn)</label>
              <textarea className="focus-ring min-h-32 w-full rounded-control border border-border bg-surface p-3.5 text-base text-ink" id="pod-note" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} />
            </div>
            <Button
              className="w-full"
              disabled={
                receiverName.trim().length < 2 ||
                (assignment.data.availableActions.collectShippingFee &&
                  parseShippingFeeAmount(shippingFeeAmount) !==
                    assignment.data.shippingFee.expectedAmount)
              }
              loading={complete.isPending}
              size="lg"
              type="submit"
            >
              {assignment.data.availableActions.collectShippingFee
                ? 'Thu phí và xác nhận đã giao'
                : 'Xác nhận đã giao'}
            </Button>
          </form>
        )}
      </main>
    </AccountLayout>
  );
}
