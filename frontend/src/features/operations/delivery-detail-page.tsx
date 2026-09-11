import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { ShipmentStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { DriverTaskMap } from '../locations/driver-task-map';
import { ShippingFeeResponsibilityCard } from '../shipments/shipping-fee-responsibility-card';
import { getMyDeliveryAssignment, startDelivery } from './operations-api';

export function DeliveryDetailPage() {
  const { assignmentId = '' } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const assignment = useQuery({
    queryKey: ['driver-delivery', assignmentId],
    queryFn: () => getMyDeliveryAssignment(assignmentId),
    enabled: Boolean(assignmentId),
  });
  const start = useMutation({
    mutationFn: () => startDelivery(assignmentId),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['driver-delivery', assignmentId], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] }),
      ]);
    },
  });
  if (assignment.isPending)
    return (
      <AccountLayout>
        <LoadingState label="Đang tải chi tiết giao hàng" />
      </AccountLayout>
    );
  const notice = (location.state as { notice?: string } | null)?.notice;
  return (
    <AccountLayout>
      <main className="mx-auto max-w-3xl">
        <PageHeader
          actions={
            <Link
              className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink"
              to="/driver/deliveries"
            >
              Quay lại danh sách
            </Link>
          }
          description="Bắt đầu giao, hoàn tất POD hoặc ghi nhận thất bại qua command riêng biệt."
          eyebrow="Driver · Delivery detail"
          title="Chi tiết giao hàng"
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
            {notice ? (
              <p
                aria-live="polite"
                className="rounded-control border border-success/30 bg-success-soft p-4 font-medium text-success"
              >
                {notice}
              </p>
            ) : null}
            {start.isError ? <ErrorSummary message={getApiErrorMessage(start.error)} /> : null}
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="wrap-anywhere font-mono text-lg font-bold text-primary">
                  {assignment.data.trackingCode}
                </span>
                <ShipmentStatusBadge status={assignment.data.shipmentStatus} />
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <Info label="Người nhận" value={assignment.data.receiver.fullName} />
                <Info label="Số điện thoại" value={assignment.data.delivery.phone} />
                <Info
                  label="Địa chỉ giao"
                  value={`${assignment.data.delivery.streetAddress}, ${assignment.data.delivery.ward}, ${assignment.data.delivery.district}, ${assignment.data.delivery.city}`}
                />
                <Info
                  label="Phân công lúc"
                  value={dateTimeFormatter.format(new Date(assignment.data.assignedAt))}
                />
                <Info
                  label="Lần giao"
                  value={String(assignment.data.attempt?.attemptNumber ?? 'Chưa bắt đầu')}
                />
              </dl>
              <a
                className="focus-ring mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-primary px-4 font-semibold text-primary sm:w-auto"
                href={`tel:${assignment.data.delivery.phone}`}
              >
                Gọi người nhận
              </a>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <ShippingFeeResponsibilityCard transaction={assignment.data.shippingFee} />
              <section className="rounded-surface border border-orange-200 bg-orange-50 p-5">
                <h2 className="font-semibold text-ink">COD</h2>
                <p className="mt-3 text-xl font-bold tabular-nums text-ink">
                  {vndFormatter.format(assignment.data.codAmount)}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Tiền thu hộ hàng hóa, không bao gồm phí vận chuyển.
                </p>
              </section>
            </section>

            <DriverTaskMap target={assignment.data.taskLocation} />

            {assignment.data.status === 'PENDING' && !assignment.data.attempt ? (
              <Button
                className="w-full"
                loading={start.isPending}
                onClick={() => start.mutate()}
                size="lg"
              >
                Bắt đầu giao hàng
              </Button>
            ) : null}

            {assignment.data.attempt?.status === 'OUT_FOR_DELIVERY' ? (
              <section className="grid gap-3 sm:grid-cols-2">
                <Link
                  className="focus-ring inline-flex min-h-12 items-center justify-center rounded-control bg-primary px-4 font-semibold text-on-primary"
                  to={`/driver/deliveries/${assignmentId}/proof`}
                >
                  {assignment.data.availableActions.collectShippingFee
                    ? 'Ghi nhận POD và thu phí'
                    : 'Ghi nhận POD'}
                </Link>
                <Link
                  className="focus-ring inline-flex min-h-12 items-center justify-center rounded-control border border-danger px-4 font-semibold text-danger"
                  to={`/driver/deliveries/${assignmentId}/failed`}
                >
                  Báo giao thất bại
                </Link>
              </section>
            ) : null}

            {assignment.data.attempt?.proof ? (
              <section className="rounded-surface border border-success/30 bg-success-soft p-5">
                <h2 className="text-lg font-semibold text-success">Proof of Delivery</h2>
                <p className="mt-2 text-base text-ink">
                  Người nhận: {assignment.data.attempt.proof.receiverName}
                </p>
                <p className="mt-1 text-base text-ink">
                  {assignment.data.attempt.proof.note || 'Không có ghi chú.'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dateTimeFormatter.format(new Date(assignment.data.attempt.proof.capturedAt))}
                </p>
              </section>
            ) : null}

            {assignment.data.attempt?.status === 'FAILED' ? (
              <section className="rounded-surface border border-danger/30 bg-red-50 p-5">
                <h2 className="text-lg font-semibold text-danger">Lần giao chưa thành công</h2>
                <p className="mt-2 text-base text-ink">{assignment.data.attempt.failureReason}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignment.data.attempt.failureNote || 'Không có ghi chú.'}
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
