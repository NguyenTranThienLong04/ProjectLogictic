import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { inputClassName } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { ShippingFeeStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { shippingFeePayerLabel } from '../shipments/shipping-fee-payer';
import type { ShippingFeeFilters as FilterValues, ShippingFeeLedgerItem } from './shipping-fee-api';
import {
  disputeShippingFee,
  listShippingFeeReconciliation,
  resolveShippingFeeDispute,
  settleShippingFee,
} from './shipping-fee-api';
import { ShippingFeeFilters } from './shipping-fee-filters';
import { ShippingFeeSummaryCards } from './shipping-fee-summary';

type NoteAction = { type: 'dispute' | 'resolve'; item: ShippingFeeLedgerItem } | null;

function formatTimestamp(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : '—';
}

function actorLabel(actor: ShippingFeeLedgerItem['collector']): string {
  return actor ? `${actor.user.fullName} · ${actor.employeeCode}` : '—';
}

export function AdminShippingFeeReconciliationPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterValues>({ page: 1, limit: 20 });
  const [searchInput, setSearchInput] = useState('');
  const [settlement, setSettlement] = useState<ShippingFeeLedgerItem | null>(null);
  const [noteAction, setNoteAction] = useState<NoteAction>(null);
  const [note, setNote] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const query = useQuery({
    queryKey: ['shipping-fees', 'reconciliation', filters],
    queryFn: () => listShippingFeeReconciliation(filters),
    placeholderData: (previous) => previous,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['shipping-fees', 'reconciliation'] });
  };
  const settle = useMutation({
    mutationFn: settleShippingFee,
    onMutate: () => setSuccessMessage(''),
    onSuccess: async (item) => {
      setSuccessMessage(`Đã đối soát phí vận chuyển cho ${item.shipment.trackingCode}.`);
      setSettlement(null);
      await refresh();
    },
  });
  const dispute = useMutation({
    mutationFn: disputeShippingFee,
    onMutate: () => setSuccessMessage(''),
    onSuccess: async (item) => {
      setSuccessMessage(`Đã mở tranh chấp phí vận chuyển cho ${item.shipment.trackingCode}.`);
      setNoteAction(null);
      setNote('');
      await refresh();
    },
  });
  const resolve = useMutation({
    mutationFn: resolveShippingFeeDispute,
    onMutate: () => setSuccessMessage(''),
    onSuccess: async (item) => {
      setSuccessMessage(`Đã giải quyết tranh chấp phí cho ${item.shipment.trackingCode}.`);
      setNoteAction(null);
      setNote('');
      await refresh();
    },
  });

  const openNoteAction = (type: 'dispute' | 'resolve', item: ShippingFeeLedgerItem) => {
    setNoteAction({ type, item });
    setNote('');
    setNoteTouched(false);
    dispute.reset();
    resolve.reset();
  };
  const noteValid = note.trim().length >= 3 && note.trim().length <= 500;
  const activeNoteMutation = noteAction?.type === 'dispute' ? dispute : resolve;

  const columns: DataTableColumn<ShippingFeeLedgerItem>[] = [
    {
      id: 'shipment',
      header: 'Vận đơn',
      render: (row) => (
        <span className="font-mono text-sm font-semibold text-primary">
          {row.shipment.trackingCode}
        </span>
      ),
    },
    {
      id: 'payer',
      header: 'Người trả phí',
      render: (row) => (
        <div>
          <p className="font-medium">{shippingFeePayerLabel(row.payer)}</p>
          {row.payerName ? (
            <p className="mt-1 text-xs text-muted-foreground">{row.payerName}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actors',
      header: 'Thu / bàn giao',
      render: (row) => (
        <dl className="grid gap-1 text-sm">
          <div>
            <dt className="inline text-muted-foreground">Thu: </dt>
            <dd className="inline">{actorLabel(row.collector)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Bàn giao: </dt>
            <dd className="inline">{actorLabel(row.remitter)}</dd>
          </div>
        </dl>
      ),
    },
    {
      align: 'right',
      id: 'amount',
      header: 'Số tiền',
      render: (row) => (
        <dl className="grid gap-1 tabular-nums">
          <div>
            <dt className="inline text-xs text-muted-foreground">Phải thu: </dt>
            <dd className="inline font-semibold">{vndFormatter.format(row.expectedAmount)}</dd>
          </div>
          <div>
            <dt className="inline text-xs text-muted-foreground">Đã bàn giao: </dt>
            <dd className="inline">
              {row.remittedAmount === null ? '—' : vndFormatter.format(row.remittedAmount)}
            </dd>
          </div>
          <div>
            <dt className="inline text-xs text-muted-foreground">Trực tuyến: </dt>
            <dd className="inline">
              {row.paidAmount === null ? '—' : vndFormatter.format(row.paidAmount)}
            </dd>
          </div>
        </dl>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <div>
          <ShippingFeeStatusBadge status={row.status} />
          {row.currentDispute ? (
            <p className="mt-2 max-w-72 text-sm leading-5 text-danger">
              {row.currentDispute.reason}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'timestamps',
      header: 'Mốc đối soát',
      render: (row) => (
        <dl className="grid gap-1 text-xs tabular-nums">
          <div>
            <dt className="inline text-muted-foreground">Thu: </dt>
            <dd className="inline">{formatTimestamp(row.collectedAt)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Bàn giao: </dt>
            <dd className="inline">{formatTimestamp(row.remittedAt)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Hoàn tất: </dt>
            <dd className="inline">{formatTimestamp(row.settledAt)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Trực tuyến: </dt>
            <dd className="inline">{formatTimestamp(row.paidAt)}</dd>
          </div>
        </dl>
      ),
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (row) => (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {row.availableActions.settle ? (
            <Button
              onClick={() => {
                settle.reset();
                setSettlement(row);
              }}
            >
              Đối soát
            </Button>
          ) : null}
          {row.availableActions.dispute ? (
            <Button onClick={() => openNoteAction('dispute', row)} variant="danger">
              Tranh chấp
            </Button>
          ) : null}
          {row.availableActions.resolve ? (
            <Button onClick={() => openNoteAction('resolve', row)}>Giải quyết</Button>
          ) : null}
          {!row.availableActions.settle &&
          !row.availableActions.dispute &&
          !row.availableActions.resolve ? (
            <span className="text-muted-foreground">—</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          description="Đối chiếu phí vận chuyển độc lập với COD. Chỉ khoản đã bàn giao đủ tiền mới được xác nhận hoàn tất."
          eyebrow="Quản trị · Tài chính vận hành"
          title="Đối soát phí vận chuyển"
        />

        {successMessage ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold text-emerald-900"
          >
            {successMessage}
          </p>
        ) : null}

        {query.data ? <ShippingFeeSummaryCards summary={query.data.summary} /> : null}

        <div className="mt-6">
          <ShippingFeeFilters
            disabled={query.isFetching}
            idPrefix="admin-shipping-fee"
            onPayerChange={(payer) => setFilters((current) => ({ ...current, payer, page: 1 }))}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={(value) =>
              setFilters((current) => ({ ...current, search: value.trim() || undefined, page: 1 }))
            }
            onStatusChange={(status) => setFilters((current) => ({ ...current, status, page: 1 }))}
            payer={filters.payer}
            searchInput={searchInput}
            status={filters.status}
          />
        </div>

        <section aria-labelledby="reconciliation-title" className="mt-6 min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink" id="reconciliation-title">
              Giao dịch phí vận chuyển
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Tranh chấp phải được giải quyết bằng command riêng trước khi khoản phí có thể đối
              soát.
            </p>
          </div>
          <DataTable
            caption="Danh sách đối soát phí vận chuyển"
            columns={columns}
            emptyDescription="Thử thay đổi bộ lọc hoặc chờ phát sinh giao dịch phí vận chuyển."
            emptyTitle="Không có giao dịch phù hợp"
            error={query.isError ? getApiErrorMessage(query.error) : undefined}
            getRowKey={(row) => row.id}
            loading={query.isPending}
            loadingLabel="Đang tải đối soát phí vận chuyển"
            onRetry={() => query.refetch()}
            rows={query.data?.items ?? []}
          />
          {query.data ? (
            <div className="mt-5">
              <Pagination
                disabled={query.isFetching}
                label="Phân trang đối soát phí vận chuyển"
                onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
                page={query.data.page}
                totalPages={query.data.totalPages}
              />
            </div>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        confirmLabel="Xác nhận đối soát"
        description={
          settlement
            ? `Xác nhận ${vndFormatter.format(settlement.expectedAmount)} của vận đơn ${settlement.shipment.trackingCode} đã được đối chiếu đầy đủ.`
            : ''
        }
        error={settle.isError ? getApiErrorMessage(settle.error) : undefined}
        loading={settle.isPending}
        onCancel={() => setSettlement(null)}
        onConfirm={() => settlement && settle.mutate(settlement.id)}
        open={settlement !== null}
        title="Hoàn tất đối soát phí vận chuyển?"
      />

      <Modal
        description={
          noteAction?.type === 'dispute'
            ? 'Ghi lý do cụ thể để tạo lịch sử tranh chấp. Khoản phí sẽ bị chặn đối soát.'
            : 'Ghi kết quả xác minh. Khoản phí sẽ trở về trạng thái trước khi tranh chấp.'
        }
        footer={
          <>
            <Button
              disabled={activeNoteMutation.isPending}
              onClick={() => setNoteAction(null)}
              variant="secondary"
            >
              Quay lại
            </Button>
            <Button
              disabled={!noteValid}
              form="shipping-fee-note-form"
              loading={activeNoteMutation.isPending}
              type="submit"
              variant={noteAction?.type === 'dispute' ? 'danger' : 'primary'}
            >
              {noteAction?.type === 'dispute' ? 'Mở tranh chấp' : 'Xác nhận giải quyết'}
            </Button>
          </>
        }
        onClose={() => setNoteAction(null)}
        open={noteAction !== null}
        title={
          noteAction?.type === 'dispute' ? 'Tranh chấp phí vận chuyển' : 'Giải quyết tranh chấp'
        }
      >
        {noteAction ? (
          <form
            id="shipping-fee-note-form"
            onSubmit={(event) => {
              event.preventDefault();
              setNoteTouched(true);
              if (!noteValid) return;
              if (noteAction.type === 'dispute') {
                dispute.mutate({ id: noteAction.item.id, reason: note.trim() });
              } else {
                resolve.mutate({ id: noteAction.item.id, resolutionNote: note.trim() });
              }
            }}
          >
            <p className="text-sm text-muted-foreground">
              Vận đơn{' '}
              <strong className="font-mono text-ink">
                {noteAction.item.shipment.trackingCode}
              </strong>
            </p>
            <label
              className="mt-4 block text-sm font-semibold text-ink"
              htmlFor="shipping-fee-note"
            >
              {noteAction.type === 'dispute' ? 'Lý do tranh chấp' : 'Kết quả xác minh'}
              <span aria-hidden="true" className="text-danger">
                {' '}
                *
              </span>
            </label>
            <textarea
              aria-describedby={noteTouched && !noteValid ? 'shipping-fee-note-error' : undefined}
              aria-invalid={noteTouched && !noteValid}
              className={`${inputClassName} mt-2 min-h-28 resize-y py-3`}
              id="shipping-fee-note"
              maxLength={500}
              onBlur={() => setNoteTouched(true)}
              onChange={(event) => {
                setNote(event.target.value);
                if (noteTouched) setNoteTouched(false);
              }}
              required
              value={note}
            />
            {noteTouched && !noteValid ? (
              <p
                aria-live="polite"
                className="mt-2 text-sm font-medium text-danger"
                id="shipping-fee-note-error"
              >
                Nội dung phải có từ 3 đến 500 ký tự.
              </p>
            ) : null}
            {activeNoteMutation.isError ? (
              <div className="mt-4">
                <ErrorSummary message={getApiErrorMessage(activeNoteMutation.error)} />
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>
    </AccountLayout>
  );
}
