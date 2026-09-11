import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { CodStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { getCodDashboard, settleCod } from './cod-api';
import type { CodTransaction } from './cod-api';

export function CodDashboardPage() {
  const client = useQueryClient();
  const [successMessage, setSuccessMessage] = useState('');
  const query = useQuery({ queryKey: ['cod-dashboard'], queryFn: getCodDashboard });
  const settle = useMutation({
    mutationFn: settleCod,
    onMutate: () => setSuccessMessage(''),
    onSuccess: async (transaction) => {
      setSuccessMessage(`Đã quyết toán COD cho vận đơn ${transaction.shipment.trackingCode}.`);
      await client.invalidateQueries({ queryKey: ['cod-dashboard'] });
    },
  });

  if (query.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải đối soát COD" />
      </AccountLayout>
    );
  }

  const rows = query.data?.items ?? [];
  const columns: DataTableColumn<CodTransaction>[] = [
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
      id: 'driver',
      header: 'Tài xế thu COD',
      render: (row) => row.collectedByDriver?.user.fullName ?? '—',
    },
    {
      align: 'right',
      id: 'expected',
      header: 'Phải thu',
      render: (row) => (
        <span className="font-semibold tabular-nums">{vndFormatter.format(row.expectedAmount)}</span>
      ),
    },
    {
      align: 'right',
      id: 'remitted',
      header: 'Đã nộp',
      render: (row) => (
        <span className="tabular-nums">
          {row.remittedAmount === null ? '—' : vndFormatter.format(row.remittedAmount)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (row) => <CodStatusBadge status={row.status} />,
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (row) => {
        if (row.status !== 'REMITTED') return <span className="text-muted-foreground">—</span>;
        const isSettling = settle.isPending && settle.variables === row.id;
        return (
          <Button
            className="w-full md:w-auto"
            disabled={settle.isPending && !isSettling}
            loading={isSettling}
            onClick={() => settle.mutate(row.id)}
          >
            Quyết toán
          </Button>
        );
      },
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Chỉ quyết toán khi số tiền thu và số tiền tài xế nộp khớp hoàn toàn với COD của vận đơn."
          eyebrow="Quản trị · Tài chính vận hành"
          title="Đối soát COD"
        />

        {successMessage ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900"
          >
            {successMessage}
          </p>
        ) : null}

        {query.data?.summary.length ? (
          <section
            aria-label="Tổng hợp COD theo trạng thái"
            className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {query.data.summary.map((item) => (
              <article
                className="rounded-surface border border-border bg-surface p-4 shadow-surface"
                key={item.status}
              >
                <CodStatusBadge status={item.status} />
                <p className="mt-3 text-xl font-bold tabular-nums tracking-tight text-ink">
                  {vndFormatter.format(item._sum.expectedAmount ?? 0)}
                </p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {item._count._all} giao dịch
                </p>
              </article>
            ))}
          </section>
        ) : null}

        {settle.isError ? (
          <div className="mt-6">
            <ErrorSummary message={getApiErrorMessage(settle.error)} />
          </div>
        ) : null}

        <section aria-labelledby="cod-transactions-title" className="mt-6 min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink" id="cod-transactions-title">
              Giao dịch COD
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Trạng thái và màu sắc dùng đúng mapping COD canonical của hệ thống.
            </p>
          </div>
          <DataTable
            caption="Danh sách giao dịch COD"
            columns={columns}
            emptyDescription="Giao dịch sẽ xuất hiện sau khi tài xế hoàn tất đơn có thu hộ."
            emptyTitle="Chưa có giao dịch COD"
            error={query.isError ? getApiErrorMessage(query.error) : undefined}
            getRowKey={(row) => row.id}
            onRetry={() => query.refetch()}
            rows={rows}
          />
        </section>
      </div>
    </AccountLayout>
  );
}
