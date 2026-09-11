import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AccountLayout } from '../auth/components/account-layout';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { getShippingFeePaymentResult } from './shipping-fee-payment-api';

const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function ShippingFeePaymentResultPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference') ?? '';
  const validReference = REFERENCE_PATTERN.test(reference);
  const query = useQuery({
    queryKey: ['shipping-fee-payment-result', reference],
    queryFn: () => getShippingFeePaymentResult(reference),
    enabled: validReference,
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return status === 'CREATING' || status === 'PENDING' ? 2_000 : false;
    },
  });
  useEffect(() => {
    if (query.data?.status !== 'SUCCEEDED') return;
    void queryClient.invalidateQueries({ queryKey: ['shipment', query.data.shipment.id] });
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    void queryClient.invalidateQueries({
      queryKey: ['shipping-fee-payment', query.data.shipment.id],
    });
  }, [query.data, queryClient]);

  return (
    <AccountLayout>
      <main className="mx-auto max-w-2xl">
        <PageHeader
          description="Trang này chỉ đọc kết quả do backend xác nhận; đường dẫn quay lại không thể tự đánh dấu đã thanh toán."
          eyebrow="Phí vận chuyển"
          title="Kết quả thanh toán"
        />
        <div className="mt-6">
          {!validReference ? (
            <EmptyState
              description="Đường dẫn không có mã giao dịch hợp lệ. Hãy mở lại từ chi tiết vận đơn."
              title="Không tìm thấy giao dịch"
            />
          ) : query.isPending ? (
            <LoadingState label="Đang kiểm tra xác nhận thanh toán" />
          ) : query.isError ? (
            <ErrorState
              message={getApiErrorMessage(query.error)}
              onRetry={() => query.refetch()}
              title="Không thể đọc kết quả thanh toán"
            />
          ) : query.data ? (
            <PaymentResultContent payment={query.data} />
          ) : null}
        </div>
      </main>
    </AccountLayout>
  );
}

function PaymentResultContent({
  payment,
}: {
  payment: Awaited<ReturnType<typeof getShippingFeePaymentResult>>;
}) {
  const succeeded = payment.status === 'SUCCEEDED';
  const failed = payment.status === 'FAILED';
  return (
    <section
      aria-live="polite"
      className={`rounded-surface border p-5 shadow-surface sm:p-6 ${
        succeeded
          ? 'border-teal-300 bg-teal-50'
          : failed
            ? 'border-danger/30 bg-danger-soft'
            : 'border-violet-300 bg-violet-50'
      }`}
    >
      <p className={`text-lg font-bold ${succeeded ? 'text-teal-900' : failed ? 'text-danger' : 'text-violet-900'}`}>
        {succeeded
          ? 'Thanh toán thành công'
          : failed
            ? 'Thanh toán chưa thành công'
            : 'Đang chờ xác nhận thanh toán'}
      </p>
      <p className="mt-2 leading-6 text-muted-foreground">
        {succeeded
          ? 'Webhook hợp lệ đã xác nhận khoản phí. Tài xế không cần thu lại phí vận chuyển.'
          : failed
            ? 'Cổng thanh toán đã báo thất bại. Quay lại vận đơn để thử lại hoặc tiếp tục theo phương thức thu hiện tại.'
            : 'Không đóng hoặc làm mới bắt buộc: hệ thống đang tự kiểm tra trạng thái authoritative từ backend.'}
      </p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <ResultDetail label="Vận đơn" value={payment.shipment.trackingCode} />
        <ResultDetail label="Số tiền" value={vndFormatter.format(payment.amount)} />
        <ResultDetail label="Mã giao dịch" value={payment.reference} />
        <ResultDetail
          label="Cập nhật lúc"
          value={dateTimeFormatter.format(
            new Date(payment.succeededAt ?? payment.failedAt ?? payment.initiatedAt),
          )}
        />
      </dl>
      <Link
        className="focus-ring ui-transition mt-6 inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-strong"
        to={`/shipments/${payment.shipment.id}`}
      >
        Quay lại vận đơn
      </Link>
    </section>
  );
}

function ResultDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
