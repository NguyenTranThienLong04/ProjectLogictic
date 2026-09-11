import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import {
  createShippingFeePayment,
  getShippingFeePaymentOverview,
} from './shipping-fee-payment-api';
import { clientRequestIdForPaymentAttempt } from './shipping-fee-payment-idempotency';

export function ShippingFeePaymentPanel({
  expectedAmount,
  shipmentId,
}: {
  expectedAmount: number;
  shipmentId: string;
}) {
  const queryClient = useQueryClient();
  const [clientRequestId, setClientRequestId] = useState<string>(() => crypto.randomUUID());
  const query = useQuery({
    queryKey: ['shipping-fee-payment', shipmentId],
    queryFn: () => getShippingFeePaymentOverview(shipmentId),
  });
  const create = useMutation({
    mutationFn: (requestId: string) =>
      createShippingFeePayment({ shipmentId, clientRequestId: requestId }),
    onSuccess: async (payment) => {
      await queryClient.invalidateQueries({ queryKey: ['shipping-fee-payment', shipmentId] });
      if (payment.checkoutUrl) {
        window.location.assign(payment.checkoutUrl);
      } else {
        window.location.assign(`/payments/result?reference=${encodeURIComponent(payment.reference)}`);
      }
    },
  });

  const startPayment = () => {
    const nextRequestId = clientRequestIdForPaymentAttempt(
      clientRequestId,
      query.data?.payment?.status ?? null,
    );
    if (nextRequestId !== clientRequestId) setClientRequestId(nextRequestId);
    create.mutate(nextRequestId);
  };

  if (query.isPending) {
    return <LoadingState label="Đang kiểm tra khả năng thanh toán" />;
  }
  if (query.isError) {
    return (
      <section className="rounded-surface border border-danger/30 bg-danger-soft p-5">
        <h2 className="font-semibold text-ink">Thanh toán phí vận chuyển</h2>
        <ErrorSummary message={getApiErrorMessage(query.error)} />
        <Button className="mt-4 w-full" onClick={() => query.refetch()} variant="secondary">
          Thử lại
        </Button>
      </section>
    );
  }
  const overview = query.data;
  if (!overview.availableActions.createPayment && !overview.payment) return null;

  return (
    <section className="rounded-surface border border-violet-200 bg-violet-50 p-5">
      <h2 className="font-semibold text-ink">Thanh toán phí vận chuyển</h2>
      {overview.payment?.status === 'SUCCEEDED' ? (
        <p className="mt-3 text-sm font-semibold text-teal-900" role="status">
          Thanh toán đã được webhook xác nhận
          {overview.payment.succeededAt
            ? ` lúc ${dateTimeFormatter.format(new Date(overview.payment.succeededAt))}`
            : ''}
          .
        </p>
      ) : overview.payment?.status === 'FAILED' ? (
        <p className="mt-3 text-sm font-semibold text-danger" role="status">
          Thanh toán chưa thành công. Bạn có thể tạo lượt thanh toán mới.
        </p>
      ) : overview.payment ? (
        <p className="mt-3 text-sm font-semibold text-violet-900" role="status">
          Đang chờ cổng thanh toán gửi xác nhận chính thức.
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Thanh toán đúng {vndFormatter.format(expectedAmount)} qua cổng bảo mật. Trạng thái chỉ
          thay đổi sau webhook đã xác thực.
        </p>
      )}
      <ErrorSummary message={create.isError ? getApiErrorMessage(create.error) : undefined} />
      {overview.availableActions.createPayment ? (
        <Button
          className="mt-4 min-h-12 w-full"
          loading={create.isPending}
          onClick={startPayment}
        >
          Thanh toán phí vận chuyển
        </Button>
      ) : null}
    </section>
  );
}
