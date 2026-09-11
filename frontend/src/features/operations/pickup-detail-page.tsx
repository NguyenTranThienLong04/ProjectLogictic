import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { ShipmentStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { DriverTaskMap } from '../locations/driver-task-map';
import { ShippingFeeResponsibilityCard } from '../shipments/shipping-fee-responsibility-card';
import {
  acceptAssignment,
  getMyAssignment,
  pickupShipment,
  rejectAssignment,
} from './operations-api';
import { parseShippingFeeAmount } from './shipping-fee-collection';
import { ShippingFeeCollectionField } from './shipping-fee-collection-field';

type Action =
  { type: 'accept' } |
  { type: 'reject'; reason: string } |
  { type: 'pickup'; note?: string; shippingFeeAmount?: number };

export function PickupDetailPage() {
  const { assignmentId = '' } = useParams();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [shippingFeeAmount, setShippingFeeAmount] = useState('');
  const [shippingFeeTouched, setShippingFeeTouched] = useState(false);
  const [success, setSuccess] = useState('');
  const assignment = useQuery({
    queryKey: ['driver-assignment', assignmentId],
    queryFn: () => getMyAssignment(assignmentId),
    enabled: Boolean(assignmentId),
  });
  const action = useMutation({
    mutationFn: (input: Action) =>
      input.type === 'accept'
        ? acceptAssignment(assignmentId)
        : input.type === 'reject'
          ? rejectAssignment({ assignmentId, reason: input.reason })
          : pickupShipment({
              assignmentId,
              note: input.note,
              shippingFeeAmount: input.shippingFeeAmount,
            }),
    onSuccess: async (updated, input) => {
      queryClient.setQueryData(['driver-assignment', assignmentId], updated);
      setSuccess(
        input.type === 'accept'
          ? 'Đã nhận nhiệm vụ lấy hàng.'
          : input.type === 'reject'
            ? 'Đã gửi lý do từ chối cho Dispatcher.'
            : updated.shippingFee.status === 'COLLECTED'
              ? 'Đã xác nhận lấy hàng, thu phí vận chuyển và tạo pickup proof.'
              : 'Đã xác nhận lấy hàng và tạo pickup proof.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver-assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] }),
      ]);
    },
  });
  if (assignment.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải chi tiết lấy hàng" />
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <main className="mx-auto max-w-3xl">
        <PageHeader
          actions={
            <Link
              className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink"
              to="/driver/assignments"
            >
              Quay lại danh sách
            </Link>
          }
          description="Thông tin nhiệm vụ và command pickup có kiểm tra ownership tại backend."
          eyebrow="Driver · Pickup detail"
          title="Chi tiết lấy hàng"
        />
        {assignment.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(assignment.error)}
              onRetry={() => void assignment.refetch()}
              title="Không thể tải nhiệm vụ"
            />
          </div>
        ) : assignment.data ? (
          <div className="mt-6 space-y-5">
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="wrap-anywhere font-mono text-lg font-bold text-primary">
                  {assignment.data.trackingCode}
                </span>
                <ShipmentStatusBadge status={assignment.data.shipmentStatus} />
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <Info label="Liên hệ lấy hàng" value={assignment.data.pickup.contactName} />
                <Info label="Số điện thoại" value={assignment.data.pickup.phone} />
                <Info
                  label="Địa chỉ"
                  value={`${assignment.data.pickup.streetAddress}, ${assignment.data.pickup.ward}, ${assignment.data.pickup.district}, ${assignment.data.pickup.city}`}
                />
                <Info
                  label="Phân công lúc"
                  value={dateTimeFormatter.format(new Date(assignment.data.assignedAt))}
                />
              </dl>
              <a
                className="focus-ring mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-primary px-4 font-semibold text-primary sm:w-auto"
                href={`tel:${assignment.data.pickup.phone}`}
              >
                Gọi người gửi
              </a>
            </section>

            <ShippingFeeResponsibilityCard transaction={assignment.data.shippingFee} />

            <DriverTaskMap target={assignment.data.taskLocation} />

            {success ? (
              <p
                aria-live="polite"
                className="rounded-control border border-success/30 bg-success-soft p-4 font-medium text-success"
              >
                {success}
              </p>
            ) : null}
            {action.isError ? <ErrorSummary message={getApiErrorMessage(action.error)} /> : null}

            {assignment.data.status === 'PENDING' ? (
              <section className="rounded-surface border border-border bg-surface p-5 shadow-surface">
                <h2 className="text-lg font-semibold text-ink">Phản hồi nhiệm vụ</h2>
                <div className="mt-4 grid gap-3">
                  <Button
                    className="w-full"
                    loading={action.isPending && action.variables?.type === 'accept'}
                    onClick={() => action.mutate({ type: 'accept' })}
                    size="lg"
                  >
                    Nhận nhiệm vụ
                  </Button>
                  <label className="text-sm font-semibold text-ink" htmlFor="pickup-reject-reason">
                    Lý do từ chối
                  </label>
                  <textarea
                    className="focus-ring min-h-28 w-full rounded-control border border-border bg-surface p-3.5 text-base text-ink"
                    id="pickup-reject-reason"
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    value={reason}
                  />
                  <Button
                    className="w-full"
                    disabled={reason.trim().length < 3 || action.isPending}
                    loading={action.isPending && action.variables?.type === 'reject'}
                    onClick={() => action.mutate({ type: 'reject', reason: reason.trim() })}
                    size="lg"
                    variant="danger"
                  >
                    Từ chối nhiệm vụ
                  </Button>
                </div>
              </section>
            ) : null}

            {assignment.data.status === 'ACCEPTED' ? (
              <form
                className="rounded-surface border border-border bg-surface p-5 shadow-surface"
                onSubmit={(event) => {
                  event.preventDefault();
                  setShippingFeeTouched(true);
                  const amount = parseShippingFeeAmount(shippingFeeAmount);
                  if (
                    assignment.data.availableActions.collectShippingFee &&
                    amount !== assignment.data.shippingFee.expectedAmount
                  ) {
                    return;
                  }
                  action.mutate({
                    type: 'pickup',
                    note: note.trim() || undefined,
                    shippingFeeAmount: assignment.data.availableActions.collectShippingFee
                      ? amount
                      : undefined,
                  });
                }}
              >
                <h2 className="text-lg font-semibold text-ink">Xác nhận lấy hàng</h2>
                {assignment.data.availableActions.collectShippingFee ? (
                  <div className="mt-4">
                    <ShippingFeeCollectionField
                      id="pickup-shipping-fee-amount"
                      onBlur={() => setShippingFeeTouched(true)}
                      onChange={(value) => {
                        setShippingFeeAmount(value);
                        if (shippingFeeTouched) setShippingFeeTouched(false);
                      }}
                      touched={shippingFeeTouched}
                      transaction={assignment.data.shippingFee}
                      value={shippingFeeAmount}
                    />
                  </div>
                ) : null}
                <label
                  className="mt-4 block text-sm font-semibold text-ink"
                  htmlFor="pickup-proof-note"
                >
                  Ghi chú proof (tùy chọn)
                </label>
                <textarea
                  className="focus-ring mt-2 min-h-28 w-full rounded-control border border-border bg-surface p-3.5 text-base text-ink"
                  id="pickup-proof-note"
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                  value={note}
                />
                <Button
                  className="mt-4 w-full"
                  disabled={
                    assignment.data.availableActions.collectShippingFee &&
                    parseShippingFeeAmount(shippingFeeAmount) !==
                      assignment.data.shippingFee.expectedAmount
                  }
                  loading={action.isPending && action.variables?.type === 'pickup'}
                  size="lg"
                  type="submit"
                >
                  {assignment.data.availableActions.collectShippingFee
                    ? 'Thu phí và xác nhận đã lấy hàng'
                    : 'Xác nhận đã lấy hàng'}
                </Button>
              </form>
            ) : null}

            {assignment.data.proof ? (
              <section className="rounded-surface border border-success/30 bg-success-soft p-5">
                <h2 className="text-lg font-semibold text-success">Pickup proof đã ghi nhận</h2>
                <p className="mt-2 text-base text-ink">
                  {assignment.data.proof.note || 'Không có ghi chú.'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dateTimeFormatter.format(new Date(assignment.data.proof.capturedAt))}
                </p>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 wrap-anywhere text-base font-semibold leading-6 text-ink">{value}</dd>
    </div>
  );
}
