import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { Modal } from '../../components/ui/modal';
import { CodPayoutStatusBadge, CodStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { acknowledgeCodPayout, getCustomerCod, type CodPayout } from './cod-api';

export function CustomerCodPanel({ shipmentId, amount }: { shipmentId: string; amount: number }) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<{ payout: CodPayout; dispute: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [success, setSuccess] = useState('');
  const query = useQuery({
    queryKey: ['cod-customer', shipmentId],
    queryFn: () => getCustomerCod(shipmentId),
    enabled: amount > 0,
    refetchInterval: 30_000,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('Chọn khoản chi trả trước khi xác nhận.');
      return acknowledgeCodPayout(selection.payout, selection.dispute ? reason.trim() : undefined);
    },
    onSuccess: (payout) => {
      setSuccess(
        payout.status === 'PAID_OUT'
          ? 'Đã lưu xác nhận bạn nhận đủ tiền COD.'
          : 'Đã ghi nhận vấn đề. Khoản này vẫn chờ chi trả và chưa được xác nhận đã nhận tiền.',
      );
      setSelection(null);
    },
    onSettled: async () => {
      await Promise.all(
        ['cod-customer', 'customer-dashboard', 'cod-dashboard', 'shipment'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const close = () => {
    if (!mutation.isPending) setSelection(null);
  };
  const cod = query.data;
  const payout = cod?.payout;
  const events: { key: string; label: string; at: string }[] = [];
  if (cod?.collectedAt) events.push({ key: 'collected', label: 'Đã thu COD', at: cod.collectedAt });
  for (const item of cod?.remittances ?? []) {
    events.push({ key: item.id, label: 'Driver đã yêu cầu bàn giao', at: item.submittedAt });
    if (item.reviewedAt)
      events.push({
        key: `${item.id}-review`,
        label:
          item.status === 'CONFIRMED'
            ? 'Công ty đã xác nhận nhận tiền'
            : 'Yêu cầu bàn giao chưa được công ty chấp nhận',
        at: item.reviewedAt,
      });
  }
  if (cod?.remittedAt && !cod.remittances.some((item) => item.status === 'CONFIRMED'))
    events.push({
      key: 'legacy',
      label: 'Đã ghi nhận bàn giao (dữ liệu lịch sử)',
      at: cod.remittedAt,
    });
  if (cod?.settledAt)
    events.push({ key: 'settled', label: 'Đã đối soát nội bộ', at: cod.settledAt });
  if (payout?.sentAt)
    events.push({ key: 'sent', label: 'Công ty đã ghi nhận gửi tiền', at: payout.sentAt });
  if (payout?.customerConfirmedAt)
    events.push({
      key: 'received',
      label: 'Bạn đã xác nhận nhận tiền',
      at: payout.customerConfirmedAt,
    });
  if (payout?.disputedAt)
    events.push({
      key: 'disputed',
      label: 'Bạn đã báo vấn đề với khoản chi trả',
      at: payout.disputedAt,
    });
  events.sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section
      className="min-w-0 rounded-surface border border-orange-200 bg-orange-50 p-5 sm:p-6"
      aria-label="COD và chi trả"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Tiền thu hộ COD</h2>
        <p className="text-xl font-bold tabular-nums">{vndFormatter.format(amount)}</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Đối soát là bước xử lý nội bộ. Chỉ xác nhận đã nhận tiền sau khi bạn thực sự nhận đủ khoản
        COD. Phí vận chuyển được quản lý riêng.
      </p>
      {amount === 0 ? (
        <p className="mt-3">Không thu COD</p>
      ) : query.isPending ? (
        <LoadingState label="Đang tải trạng thái COD" />
      ) : query.isError ? (
        <ErrorState
          title="Không tải được COD"
          message={getApiErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {cod ? <CodStatusBadge status={cod.status} /> : <p>Chưa thu COD</p>}
            {payout && <CodPayoutStatusBadge status={payout.status} />}
          </div>
          {events.length > 0 && (
            <ol
              className="mt-5 space-y-4 border-l-2 border-orange-200 pl-4"
              aria-label="Lịch sử COD"
            >
              {events.map((event) => (
                <li key={event.key}>
                  <p className="font-medium">{event.label}</p>
                  <time className="text-sm text-muted-foreground" dateTime={event.at}>
                    {dateTimeFormatter.format(new Date(event.at))}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {cod?.status === 'SETTLED' && !payout && (
            <p className="mt-4">COD đã đối soát, đang chờ công ty chi trả.</p>
          )}
          {payout && (
            <div className="mt-5 space-y-3 rounded-control border border-border bg-surface p-4">
              <p className="font-semibold">
                Chi trả {vndFormatter.format(payout.amount)} ·{' '}
                {payout.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt'}
              </p>
              <p className="break-words text-sm">Mã chứng từ: {payout.reference ?? 'Chưa có'}</p>
              {payout.status === 'PENDING' && (
                <p>Công ty đã lập khoản chi trả, chưa ghi nhận gửi tiền.</p>
              )}
              {payout.status === 'SENT' && (
                <>
                  <p>Đang chờ bạn xác nhận đã nhận tiền.</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="min-h-12"
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.reset();
                        setSuccess('');
                        setSelection({ payout, dispute: false });
                      }}
                    >
                      Tôi đã nhận đủ tiền
                    </Button>
                    <Button
                      className="min-h-12"
                      variant="secondary"
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.reset();
                        setSuccess('');
                        setReason('');
                        setSelection({ payout, dispute: true });
                      }}
                    >
                      Tôi chưa nhận / Có vấn đề
                    </Button>
                  </div>
                </>
              )}
              {payout.status === 'DISPUTED' && (
                <>
                  <p className="font-medium">
                    Có vấn đề với khoản chi trả. Công ty cần kiểm tra chứng từ và liên hệ với bạn.
                  </p>
                  <p className="break-words text-sm">{payout.disputeReason}</p>
                </>
              )}
            </div>
          )}
        </>
      )}
      {success && (
        <p role="status" className="mt-4 font-medium">
          {success}
        </p>
      )}
      <Modal
        open={selection !== null}
        onClose={close}
        title={selection?.dispute ? 'Báo vấn đề với khoản chi trả' : 'Xác nhận đã nhận đủ tiền COD'}
        size="sm"
        description={
          selection
            ? `${vndFormatter.format(selection.payout.amount)} · Chứng từ: ${selection.payout.reference}. ${selection.dispute ? 'Khoản này sẽ được giữ ở trạng thái có vấn đề.' : 'Chỉ xác nhận khi tiền đã thực sự vào tài khoản hoặc bạn đã nhận đủ tiền mặt.'}`
            : ''
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate();
          }}
        >
          {selection?.dispute && (
            <FormField
              id="cod-dispute"
              label="Vấn đề bạn gặp phải"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
          {mutation.isError && <ErrorSummary message={getApiErrorMessage(mutation.error)} />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
              Quay lại
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={Boolean(selection?.dispute && !reason.trim())}
            >
              {selection?.dispute ? 'Gửi báo cáo' : 'Xác nhận đã nhận tiền'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
