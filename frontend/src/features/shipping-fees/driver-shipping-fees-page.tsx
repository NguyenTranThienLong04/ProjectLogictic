import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { ShippingFeeStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { parseShippingFeeAmount } from '../operations/shipping-fee-collection';
import { shippingFeePayerLabel } from '../shipments/shipping-fee-payer';
import type { ShippingFeeFilters as FilterValues, ShippingFeeLedgerItem } from './shipping-fee-api';
import { listMyShippingFees, remitShippingFee } from './shipping-fee-api';
import { ShippingFeeFilters } from './shipping-fee-filters';
import { ShippingFeeSummaryCards } from './shipping-fee-summary';

export function DriverShippingFeesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterValues>({ page: 1, limit: 20 });
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<ShippingFeeLedgerItem | null>(null);
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const query = useQuery({
    queryKey: ['shipping-fees', 'mine', filters],
    queryFn: () => listMyShippingFees(filters),
    placeholderData: (previous) => previous,
  });
  const remit = useMutation({
    mutationFn: remitShippingFee,
    onMutate: () => setSuccessMessage(''),
    onSuccess: async (transaction) => {
      setSuccessMessage(
        `Đã ghi nhận bàn giao phí cho vận đơn ${transaction.shipment.trackingCode}.`,
      );
      setSelected(null);
      setAmount('');
      setTouched(false);
      await queryClient.invalidateQueries({ queryKey: ['shipping-fees', 'mine'] });
    },
  });

  const openRemittance = (item: ShippingFeeLedgerItem) => {
    setSelected(item);
    setAmount('');
    setTouched(false);
    remit.reset();
  };
  const parsedAmount = parseShippingFeeAmount(amount);
  const invalidAmount = touched && selected !== null && parsedAmount !== selected.expectedAmount;

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
      render: (row) => shippingFeePayerLabel(row.payer),
    },
    {
      align: 'right',
      id: 'amount',
      header: 'Số tiền',
      render: (row) => (
        <span className="font-semibold tabular-nums">
          {vndFormatter.format(row.expectedAmount)}
        </span>
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
      header: 'Thời điểm',
      render: (row) => (
        <dl className="grid gap-1 text-sm">
          <div>
            <dt className="inline text-muted-foreground">Thu: </dt>
            <dd className="inline tabular-nums">
              {row.collectedAt ? dateTimeFormatter.format(new Date(row.collectedAt)) : '—'}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Bàn giao: </dt>
            <dd className="inline tabular-nums">
              {row.remittedAt ? dateTimeFormatter.format(new Date(row.remittedAt)) : '—'}
            </dd>
          </div>
        </dl>
      ),
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (row) =>
        row.availableActions.remit ? (
          <Button className="w-full sm:w-auto" onClick={() => openRemittance(row)}>
            Bàn giao phí
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Theo dõi các khoản phí bạn đã thu và bàn giao từng khoản bằng đúng số tiền VND. Phí vận chuyển luôn tách riêng với COD."
          eyebrow="Tài xế · Phí vận chuyển"
          title="Bàn giao phí đã thu"
        />

        {successMessage ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold text-emerald-900"
          >
            {successMessage}
          </p>
        ) : null}

        {query.data ? (
          <ShippingFeeSummaryCards
            summary={query.data.summary.filter((item) =>
              ['COLLECTED', 'REMITTED', 'SETTLED', 'DISPUTED'].includes(item.status),
            )}
          />
        ) : null}

        <div className="mt-6">
          <ShippingFeeFilters
            disabled={query.isFetching}
            idPrefix="driver-shipping-fee"
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

        <section aria-labelledby="driver-fees-title" className="mt-6 min-w-0">
          <h2 className="mb-4 text-lg font-semibold text-ink" id="driver-fees-title">
            Phí thuộc phạm vi thu của bạn
          </h2>
          <DataTable
            caption="Danh sách phí vận chuyển tài xế đã thu"
            columns={columns}
            emptyDescription="Các khoản phí sẽ xuất hiện sau khi bạn thu phí thành công tại pickup hoặc delivery."
            emptyTitle="Chưa có phí đã thu"
            error={query.isError ? getApiErrorMessage(query.error) : undefined}
            getRowKey={(row) => row.id}
            loading={query.isPending}
            loadingLabel="Đang tải phí vận chuyển"
            onRetry={() => query.refetch()}
            rows={query.data?.items ?? []}
          />
          {query.data ? (
            <div className="mt-5">
              <Pagination
                disabled={query.isFetching}
                label="Phân trang phí vận chuyển của tài xế"
                onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
                page={query.data.page}
                totalPages={query.data.totalPages}
              />
            </div>
          ) : null}
        </section>
      </div>

      <Modal
        description="Đếm tiền thực tế và nhập đúng số tiền phí vận chuyển. Thao tác này không liên quan đến COD."
        footer={
          <>
            <Button
              disabled={remit.isPending}
              onClick={() => setSelected(null)}
              variant="secondary"
            >
              Quay lại
            </Button>
            <Button
              disabled={!selected || parsedAmount !== selected.expectedAmount}
              form="shipping-fee-remittance-form"
              loading={remit.isPending}
              type="submit"
            >
              Xác nhận bàn giao
            </Button>
          </>
        }
        onClose={() => setSelected(null)}
        open={selected !== null}
        title="Bàn giao phí vận chuyển"
      >
        {selected ? (
          <form
            id="shipping-fee-remittance-form"
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (parsedAmount === selected.expectedAmount) {
                remit.mutate({ id: selected.id, amount: parsedAmount });
              }
            }}
          >
            <p className="rounded-control border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              Vận đơn <strong className="font-mono">{selected.shipment.trackingCode}</strong> · cần
              bàn giao{' '}
              <strong className="tabular-nums">
                {vndFormatter.format(selected.expectedAmount)}
              </strong>
            </p>
            <label
              className="mt-5 block text-sm font-semibold text-ink"
              htmlFor="remittance-amount"
            >
              Số tiền bàn giao (VND)
              <span aria-hidden="true" className="text-danger">
                {' '}
                *
              </span>
            </label>
            <Input
              aria-describedby={
                invalidAmount ? 'remittance-help remittance-error' : 'remittance-help'
              }
              aria-invalid={invalidAmount}
              className="mt-2 tabular-nums"
              id="remittance-amount"
              inputMode="numeric"
              onBlur={() => setTouched(true)}
              onChange={(event) => {
                setAmount(event.target.value.replace(/\D/g, ''));
                if (touched) setTouched(false);
              }}
              pattern="[0-9]*"
              required
              value={amount}
            />
            <p className="mt-2 text-sm leading-6 text-muted-foreground" id="remittance-help">
              Chỉ chấp nhận số nguyên VND khớp tuyệt đối với phí đã thu.
            </p>
            {invalidAmount ? (
              <p
                aria-live="polite"
                className="mt-2 text-sm font-medium text-danger"
                id="remittance-error"
              >
                Số tiền phải đúng {vndFormatter.format(selected.expectedAmount)}.
              </p>
            ) : null}
            {remit.isError ? (
              <div className="mt-4">
                <ErrorSummary message={getApiErrorMessage(remit.error)} />
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>
    </AccountLayout>
  );
}
