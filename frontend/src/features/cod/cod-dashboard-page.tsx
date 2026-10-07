import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { Modal } from '../../components/ui/modal';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { Select } from '../../components/ui/select';
import {
  CodPayoutStatusBadge,
  CodRemittanceStatusBadge,
  CodStatusBadge,
} from '../../components/ui/status-badge';
import {
  codStatusBadgeConfig,
  codPayoutStatusBadgeConfig,
} from '../../components/ui/status-badge-config';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import {
  createCodPayout,
  getCodDashboard,
  getMyCod,
  remitCod,
  reviewRemittance,
  sendCodPayout,
  settleCod,
} from './cod-api';
import type { CodListQuery, CodPayout, CodStatus, CodTransaction } from './cod-api';

type Action = 'submit' | 'confirm' | 'reject' | 'settle' | 'create' | 'send';
const labels: Record<Action, string> = {
  submit: 'Gửi yêu cầu bàn giao',
  confirm: 'Xác nhận đã nhận đủ',
  reject: 'Từ chối bàn giao',
  settle: 'Hoàn tất đối soát nội bộ',
  create: 'Tạo khoản chi trả',
  send: 'Ghi nhận đã gửi tiền',
};
const descriptions: Record<Action, string> = {
  submit: 'Yêu cầu này sẽ chờ công ty kiểm tiền và xác nhận đã nhận đủ.',
  confirm: 'Chỉ xác nhận sau khi đã kiểm đếm và thực sự nhận đủ tiền COD từ tài xế.',
  reject: 'Ghi lý do để tài xế kiểm tra và gửi lại yêu cầu. COD vẫn là khoản đã thu.',
  settle:
    'Xác nhận đã hoàn tất đối soát nội bộ khoản COD. Bước này chưa xác nhận khách đã nhận tiền.',
  create:
    'Lập khoản chi trả thủ công đầy đủ COD cho khách hàng. Mã chứng từ sẽ được hiển thị cho khách.',
  send: 'Chỉ ghi nhận sau khi đã thực sự chuyển khoản hoặc giao tiền mặt theo chứng từ dưới đây. Tiếp theo cần khách xác nhận.',
};

export function CodDashboardPage({ driver = false }: { driver?: boolean }) {
  const client = useQueryClient();
  const [success, setSuccess] = useState('');
  const [selection, setSelection] = useState<{
    row: CodTransaction;
    action: Action;
    requestId: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<CodPayout['method']>('BANK_TRANSFER');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CodStatus | ''>('');
  const [payoutStatus, setPayoutStatus] = useState<CodListQuery['payoutStatus'] | ''>('');
  const params: CodListQuery = {
    page,
    limit: 20,
    status: status || undefined,
    ...(!driver && payoutStatus ? { payoutStatus } : {}),
  };
  const query = useQuery({
    queryKey: ['cod-dashboard', driver ? 'mine' : 'all', params],
    queryFn: () => (driver ? getMyCod(params) : getCodDashboard(params)),
    refetchInterval: 30_000,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('Chọn giao dịch trước khi thao tác.');
      const { row, action, requestId } = selection;
      const pending = row.remittances.find((item) => item.status === 'PENDING');
      switch (action) {
        case 'submit':
          return remitCod({
            shipmentId: row.shipmentId,
            amount: row.expectedAmount,
            clientRequestId: requestId,
            note: note.trim() || undefined,
          });
        case 'confirm':
        case 'reject':
          if (!pending) throw new Error('Yêu cầu bàn giao đã thay đổi. Hãy tải lại.');
          return reviewRemittance(
            pending.id,
            pending.version,
            action === 'reject' ? reason.trim() : undefined,
          );
        case 'settle':
          return settleCod(row.id);
        case 'create':
          return createCodPayout(row.id, {
            amount: row.expectedAmount,
            method,
            reference: reference.trim(),
            note: note.trim() || undefined,
          });
        case 'send':
          if (!row.payout) throw new Error('Không tìm thấy khoản chi trả.');
          return sendCodPayout(row.payout);
      }
    },
    onSuccess: () => {
      setSuccess(
        selection?.action === 'submit'
          ? 'Đã gửi yêu cầu. Đang chờ công ty xác nhận đã nhận tiền.'
          : 'Đã lưu xác nhận COD.',
      );
      setSelection(null);
    },
    onSettled: async () => {
      await Promise.all(
        [
          'cod-dashboard',
          'cod-customer',
          'customer-dashboard',
          'admin-dashboard',
          'driver-dashboard',
          'shipment',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  const choose = (row: CodTransaction, action: Action) => {
    mutation.reset();
    setSuccess('');
    setReason('');
    setReference('');
    setNote('');
    setMethod('BANK_TRANSFER');
    setSelection({ row, action, requestId: crypto.randomUUID() });
  };
  const close = () => {
    if (!mutation.isPending) setSelection(null);
  };

  const actionButton = (row: CodTransaction, action: Action, text = labels[action]) => (
    <Button
      className="min-h-12 w-full"
      disabled={mutation.isPending || query.isError}
      onClick={() => choose(row, action)}
      variant={action === 'reject' ? 'secondary' : 'primary'}
    >
      {text}
    </Button>
  );
  const columns: DataTableColumn<CodTransaction>[] = [
    {
      id: 'shipment',
      header: 'Vận đơn / Khách hàng',
      render: (row) => (
        <div className="space-y-1">
          <p className="font-mono font-semibold text-primary">{row.shipment.trackingCode}</p>
          {!driver && <p>{row.shipment.customer.fullName}</p>}
          <p className="text-sm text-muted-foreground">
            {row.collectedByDriver?.user.fullName ?? '—'}
          </p>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Tiền COD',
      align: 'right',
      render: (row) => (
        <span className="font-semibold tabular-nums">
          {vndFormatter.format(row.expectedAmount)}
        </span>
      ),
    },
    { id: 'status', header: 'Đối soát', render: (row) => <CodStatusBadge status={row.status} /> },
    {
      id: 'handover',
      header: 'Bàn giao',
      render: (row) => (
        <div className="space-y-2">
          {row.remittances[0] ? (
            <>
              <CodRemittanceStatusBadge status={row.remittances[0].status} />
              {row.remittances[0].status === 'PENDING' && (
                <p className="text-sm">Đang chờ công ty xác nhận đã nhận tiền</p>
              )}
              {row.remittances[0].rejectionReason && (
                <p className="break-words text-sm">{row.remittances[0].rejectionReason}</p>
              )}
              <details className="text-sm">
                <summary className="focus-ring cursor-pointer rounded-control py-2">
                  Lịch sử bàn giao
                </summary>
                <ol className="mt-2 space-y-3">
                  {row.remittances.map((item) => (
                    <li key={item.id}>
                      <CodRemittanceStatusBadge status={item.status} />
                      <p className="mt-1">{dateTimeFormatter.format(new Date(item.submittedAt))}</p>
                      {item.rejectionReason && (
                        <p className="break-words">{item.rejectionReason}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {row.status === 'COLLECTED' ? 'Chưa gửi yêu cầu' : 'Chưa có lịch sử xác nhận hai bên'}
            </span>
          )}
        </div>
      ),
    },
    ...(!driver
      ? [
          {
            id: 'payout',
            header: 'Chi trả cho khách',
            render: (row: CodTransaction) =>
              row.payout ? (
                <div className="space-y-2">
                  <CodPayoutStatusBadge status={row.payout.status} />
                  <p className="text-sm">
                    {row.payout.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt'}
                  </p>
                  <p className="break-words text-sm">{row.payout.reference}</p>
                  {row.payout.disputeReason && (
                    <p className="break-words text-sm text-danger">{row.payout.disputeReason}</p>
                  )}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {row.status === 'SETTLED' ? 'Chờ tạo khoản chi trả' : 'Chưa đối soát'}
                </span>
              ),
          },
        ]
      : []),
    {
      id: 'actions',
      header: 'Thao tác',
      render: (row) => (
        <div className="min-w-0 space-y-2 lg:w-56">
          {driver &&
            row.status === 'COLLECTED' &&
            !row.remittances.some((item) => item.status === 'PENDING') &&
            actionButton(row, 'submit', `Bàn giao COD ${vndFormatter.format(row.expectedAmount)}`)}
          {!driver && row.remittances.some((item) => item.status === 'PENDING') && (
            <>
              {actionButton(row, 'confirm')}
              {actionButton(row, 'reject')}
            </>
          )}
          {!driver && row.status === 'REMITTED' && actionButton(row, 'settle')}
          {!driver && row.status === 'SETTLED' && !row.payout && actionButton(row, 'create')}
          {!driver && row.payout?.status === 'PENDING' && actionButton(row, 'send')}
        </div>
      ),
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto min-w-0 max-w-7xl">
        <PageHeader
          title={driver ? 'Bàn giao COD' : 'Đối soát và chi trả COD'}
          eyebrow={driver ? 'Tài xế · COD' : 'Quản trị · COD'}
          description={
            driver
              ? 'Gửi yêu cầu sau khi bàn giao tiền COD hàng hóa. Công ty sẽ kiểm tiền và xác nhận. Phí vận chuyển nằm ở mục Bàn giao phí.'
              : 'Nhận tiền từ tài xế → đối soát nội bộ → gửi tiền cho khách → khách xác nhận đã nhận. COD tách biệt với phí vận chuyển.'
          }
          actions={
            <Button
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Tải lại
            </Button>
          }
        />
        {success && (
          <p
            role="status"
            className="mt-4 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm text-emerald-900"
          >
            {success}
          </p>
        )}
        {!!query.data?.summary.length && (
          <section
            aria-label="Tổng hợp COD"
            className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {query.data.summary.map((item) => (
              <article
                key={item.status}
                className="rounded-surface border border-border bg-surface p-4"
              >
                <CodStatusBadge status={item.status} />
                <p className="mt-3 text-xl font-bold tabular-nums">
                  {vndFormatter.format(item._sum.expectedAmount ?? 0)}
                </p>
                <p className="mt-1 text-sm">{item._count._all} giao dịch</p>
              </article>
            ))}
          </section>
        )}
        <section className="mt-6 min-w-0">
          <div className="mb-4 grid gap-3 sm:grid-cols-2" aria-label="Bộ lọc COD">
            <div>
              <label htmlFor="cod-status-filter" className="mb-1.5 block text-sm font-semibold">
                Trạng thái COD
              </label>
              <Select
                id="cod-status-filter"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as CodStatus | '');
                  setPage(1);
                }}
              >
                <option value="">Tất cả trạng thái COD</option>
                {Object.entries(codStatusBadgeConfig).map(([value, appearance]) => (
                  <option key={value} value={value}>
                    {appearance.label}
                  </option>
                ))}
              </Select>
            </div>
            {!driver && (
              <div>
                <label htmlFor="cod-payout-filter" className="mb-1.5 block text-sm font-semibold">
                  Chi trả khách hàng
                </label>
                <Select
                  id="cod-payout-filter"
                  value={payoutStatus}
                  onChange={(event) => {
                    setPayoutStatus(event.target.value as CodListQuery['payoutStatus']);
                    setPage(1);
                  }}
                >
                  <option value="">Tất cả khoản chi trả</option>
                  <option value="NONE">Chưa tạo khoản chi trả</option>
                  {Object.entries(codPayoutStatusBadgeConfig).map(([value, appearance]) => (
                    <option key={value} value={value}>
                      {appearance.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          {query.isPending ? (
            <LoadingState label="Đang tải COD" />
          ) : (
            <DataTable
              wide
              caption="Giao dịch COD và xác nhận tiền"
              columns={columns}
              rows={query.data?.items ?? []}
              getRowKey={(row) => row.id}
              error={query.isError ? getApiErrorMessage(query.error) : undefined}
              onRetry={() => void query.refetch()}
              emptyTitle="Không có giao dịch COD phù hợp"
              emptyDescription="Thử thay đổi bộ lọc để xem các giao dịch khác."
            />
          )}
          {query.data && !query.isError && (
            <div className="mt-4 space-y-3 [&_button]:min-h-12">
              <p role="status" className="text-sm text-muted-foreground">
                {query.data.total} giao dịch phù hợp · {query.data.items.length} giao dịch trên
                trang này.
              </p>
              {page > Math.max(1, query.data.totalPages) ? (
                <Button variant="secondary" onClick={() => setPage(1)}>
                  Về trang đầu
                </Button>
              ) : (
                <Pagination
                  page={page}
                  totalPages={query.data.totalPages}
                  onPageChange={setPage}
                  disabled={query.isFetching}
                  label="Phân trang COD"
                />
              )}
            </div>
          )}
        </section>
        <p className="mt-3 text-sm text-muted-foreground">
          Tổng hợp tính trên toàn bộ giao dịch thuộc quyền truy cập, không thay đổi theo trang hoặc
          bộ lọc.
        </p>
        <Modal
          open={selection !== null}
          title={selection ? labels[selection.action] : 'COD'}
          description={selection ? descriptions[selection.action] : ''}
          onClose={close}
          size="sm"
        >
          {selection && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!mutation.isPending) mutation.mutate();
              }}
            >
              <p className="font-semibold">
                {selection.row.shipment.trackingCode} ·{' '}
                <span className="tabular-nums">
                  {vndFormatter.format(selection.row.expectedAmount)}
                </span>
              </p>
              {!driver && <p>Khách hàng: {selection.row.shipment.customer.fullName}</p>}
              {selection.action === 'confirm' && (
                <p>
                  Tài xế {selection.row.collectedByDriver?.user.fullName} yêu cầu bàn giao{' '}
                  {vndFormatter.format(selection.row.expectedAmount)}.
                </p>
              )}
              {selection.action === 'reject' && (
                <FormField
                  id="cod-reason"
                  label="Lý do từ chối"
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
              {selection.action === 'create' && (
                <>
                  <div>
                    <label htmlFor="cod-method" className="mb-1.5 block text-sm font-semibold">
                      Hình thức chi trả
                    </label>
                    <Select
                      id="cod-method"
                      value={method}
                      onChange={(event) => setMethod(event.target.value as CodPayout['method'])}
                    >
                      <option value="BANK_TRANSFER">Chuyển khoản ngân hàng</option>
                      <option value="CASH">Tiền mặt</option>
                    </Select>
                  </div>
                  <FormField
                    id="cod-reference"
                    label={
                      method === 'BANK_TRANSFER'
                        ? 'Mã giao dịch chuyển khoản'
                        : 'Mã biên nhận tiền mặt'
                    }
                    helperText="Chỉ nhập mã chứng từ; không nhập số tài khoản hoặc thông tin nhạy cảm."
                    required
                    maxLength={200}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </>
              )}
              {(selection.action === 'create' || selection.action === 'submit') && (
                <FormField
                  id="cod-note"
                  label="Ghi chú nội bộ (tùy chọn)"
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
              {selection.action === 'send' && (
                <p className="break-words">Chứng từ: {selection.row.payout?.reference}</p>
              )}
              {mutation.isError && <ErrorSummary message={getApiErrorMessage(mutation.error)} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
                  Quay lại
                </Button>
                <Button
                  type="submit"
                  loading={mutation.isPending}
                  disabled={
                    (selection.action === 'reject' && !reason.trim()) ||
                    (selection.action === 'create' && !reference.trim())
                  }
                >
                  {labels[selection.action]}
                </Button>
              </div>
            </form>
          )}
        </Modal>
      </div>
    </AccountLayout>
  );
}
