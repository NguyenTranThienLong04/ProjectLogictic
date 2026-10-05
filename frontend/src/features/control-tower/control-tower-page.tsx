import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { Select } from '../../components/ui/select';
import { StatusBadge } from '../../components/ui/status-badge';
import {
  shipmentStatusBadgeConfig,
  lineHaulTripStatusBadgeConfig,
  type StatusBadgeAppearance,
} from '../../components/ui/status-badge-config';
import { getApiErrorMessage } from '../../services/api-error';
import { formatDateTime } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { MetricCard } from '../dashboards/dashboard-components';
import { getControlTower, getControlTowerFilters } from './control-tower-api';
import { ControlTowerFilters } from './control-tower-filters';
import {
  agingLabel,
  exceptionLabel,
  itemPath,
  slaLabels,
  sortLabels,
  stageLabels,
  transferPath,
  tripPath,
} from './control-tower-model';
import type { OperationsRole, SlaState, TowerItem, TowerSort } from './control-tower-types';

const slaAppearance: Record<SlaState, StatusBadgeAppearance> = {
  ON_TIME: {
    label: slaLabels.ON_TIME,
    surface: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  AT_RISK: {
    label: slaLabels.AT_RISK,
    surface: 'border-orange-300 bg-orange-100 text-orange-900',
    dot: 'bg-orange-600',
  },
  OVERDUE: {
    label: slaLabels.OVERDUE,
    surface: 'border-red-300 bg-red-50 text-red-900',
    dot: 'bg-red-600',
  },
};
const linkClass =
  'focus-ring inline-flex min-h-11 items-center rounded-control font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary';
const dateLabel = (value: string | null) => (value ? formatDateTime(value) : '—');

export function ControlTowerPage({ role }: { role: OperationsRole }) {
  const [params, setParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const options = useQuery({
    queryKey: ['control-tower-filters'],
    queryFn: getControlTowerFilters,
    staleTime: 60000,
  });
  const tower = useQuery({
    queryKey: ['control-tower', params.toString()],
    queryFn: ({ signal }) => getControlTower(params, signal),
    refetchInterval: autoRefresh ? 60000 : false,
    refetchIntervalInBackground: false,
    staleTime: 15000,
  });
  const data = tower.isError ? undefined : tower.data;
  const sort = params.get('sort') ?? 'PRIORITY';
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  }
  const sortable = (label: string, value: TowerSort) => (
    <button
      className="focus-ring min-h-11 cursor-pointer rounded-control text-left hover:text-primary"
      type="button"
      onClick={() => change('sort', value)}
      aria-label={`Sắp xếp: ${sortLabels[value]}`}
    >
      {label}
      {sort === value ? (value.endsWith('DESC') ? ' ↓' : ' ↑') : ' ↕'}
    </button>
  );
  const columns: DataTableColumn<TowerItem>[] = [
    {
      id: 'code',
      header: sortable('Đối tượng', 'CODE_ASC'),
      mobileLabel: 'Đối tượng',
      ariaSort: sort === 'CODE_ASC' ? 'ascending' : undefined,
      render: (row) => (
        <div>
          <p className="text-xs text-muted-foreground">
            {row.entityType === 'TRIP' ? 'Line-haul Trip' : 'Shipment'}
          </p>
          <Link className={`${linkClass} font-mono`} to={itemPath(role, row)}>
            {row.code}
          </Link>
        </div>
      ),
    },
    {
      id: 'stage',
      header: 'Stage / trạng thái',
      render: (row) => {
        const appearances: Record<string, StatusBadgeAppearance> =
          row.entityType === 'TRIP' ? lineHaulTripStatusBadgeConfig : shipmentStatusBadgeConfig;
        return (
          <div className="space-y-1">
            <p className="font-semibold">{stageLabels[row.stage] ?? row.stage}</p>
            {appearances[row.status] ? (
              <StatusBadge appearance={appearances[row.status]} className="whitespace-normal" />
            ) : (
              row.status
            )}
          </div>
        );
      },
    },
    {
      id: 'warehouse',
      header: 'Kho / tuyến',
      render: (row) => (
        <div className="space-y-1">
          <p>
            {row.originWarehouseCode ?? 'Chưa có kho'} →{' '}
            {row.destinationWarehouseCode ?? 'Chưa có kho đích'}
          </p>
          {row.currentWarehouseCode ? (
            <p className="text-xs text-muted-foreground">Hiện tại: {row.currentWarehouseCode}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'sla',
      header: sortable('SLA / deadline', 'DEADLINE_ASC'),
      mobileLabel: 'SLA / deadline',
      ariaSort: sort === 'DEADLINE_ASC' ? 'ascending' : undefined,
      render: (row) => (
        <div className="space-y-2">
          {row.slaState ? (
            <StatusBadge appearance={slaAppearance[row.slaState]} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {row.timestampQuality !== 'VALID' ? 'Chưa xác định SLA' : 'Chưa áp dụng SLA'}
            </span>
          )}
          <p className="text-xs tabular-nums">{dateLabel(row.deadline)}</p>
        </div>
      ),
    },
    {
      id: 'aging',
      header: sortable('Aging', 'AGING_DESC'),
      mobileLabel: 'Aging',
      ariaSort: sort === 'AGING_DESC' ? 'descending' : undefined,
      render: (row) => (
        <div className="space-y-1">
          <p className={`font-semibold tabular-nums ${row.isAging ? 'text-orange-900' : ''}`}>
            {agingLabel(row.agingSeconds)}
          </p>
          <p className="text-xs text-muted-foreground">Từ: {dateLabel(row.stageStartedAt)}</p>
          {row.isAging ? (
            <p className="text-xs font-semibold text-orange-900">Lưu stage lâu</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'exception',
      header: 'Cần xử lý',
      render: (row) => (
        <div className="space-y-1">
          {row.exception ? (
            <p className="font-semibold text-danger">{exceptionLabel(row.exception)}</p>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {row.exception &&
          row.timestampQuality !== 'VALID' &&
          !row.exception.startsWith('TIMESTAMP_') ? (
            <p className="text-xs text-danger">
              {exceptionLabel(`TIMESTAMP_${row.timestampQuality}`)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'related',
      header: 'Liên quan',
      render: (row) => (
        <div className="flex flex-col items-start">
          {row.transferId && row.transferWarehouseId ? (
            <Link
              className={linkClass}
              to={transferPath(role, row.transferWarehouseId, row.transferId)}
            >
              {row.transferCode}
            </Link>
          ) : null}
          {row.entityType === 'SHIPMENT' && row.tripId ? (
            <Link className={linkClass} to={tripPath(role, row.tripId)}>
              {row.tripCode}
            </Link>
          ) : null}
          {!row.transferId && (row.entityType === 'TRIP' || !row.tripId) ? '—' : null}
        </div>
      ),
    },
  ];
  const summary = data?.summary;
  return (
    <AccountLayout>
      <main className="mx-auto max-w-[1600px] space-y-6">
        <PageHeader
          eyebrow={`${role === 'admin' ? 'Admin' : 'Dispatcher'} · Điều hành`}
          title="Control Tower"
          description="Theo dõi SLA, thời gian lưu stage và ngoại lệ cần xử lý."
          actions={
            <Button variant="secondary" loading={tower.isFetching} onClick={() => tower.refetch()}>
              Tải lại
            </Button>
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-primary-soft px-4 py-3 text-sm">
          <p role="status">
            {data ? `Snapshot: ${dateLabel(data.asOf)}` : 'Chưa có snapshot'}
            {tower.isFetching ? ' · Đang cập nhật…' : ''}
          </p>
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              className="size-4"
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Tự cập nhật mỗi 60 giây
          </label>
        </div>
        {options.isPending ? (
          <LoadingState label="Đang tải bộ lọc" />
        ) : options.isError ? (
          <ErrorState
            message={getApiErrorMessage(options.error)}
            onRetry={() => options.refetch()}
          />
        ) : (
          <ControlTowerFilters
            key={params.toString()}
            params={params}
            options={options.data}
            onApply={setParams}
          />
        )}
        {summary ? (
          <section aria-label="KPI vận hành" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              KPI Shipment theo bộ lọc · Chuyến được đếm riêng.
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Shipment active" value={String(summary.activeShipments)} />
              <MetricCard
                label="Đang pickup"
                value={String(summary.pickup)}
                detail="Đến khi nhập kho origin"
              />
              <MetricCard label="Tại kho origin" value={String(summary.originWarehouse)} />
              <MetricCard label="Transfer / line-haul" value={String(summary.inTransit)} />
              <MetricCard
                label="Kho đích / chờ giao"
                value={String(summary.destinationWarehouse)}
              />
              <MetricCard label="Out for delivery" value={String(summary.outForDelivery)} />
              <MetricCard label="Exception" value={String(summary.exceptions)} tone="warning" />
              <MetricCard label="Overdue SLA" value={String(summary.overdue)} tone="danger" />
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Sắp quá SLA: <strong className="text-orange-900">{summary.atRisk}</strong> · Lưu stage
              lâu: <strong>{summary.aging}</strong> · SLA chưa xác định / áp dụng:{' '}
              <strong>{summary.unavailableSla}</strong> · Trip active:{' '}
              <strong>{summary.activeTrips}</strong> · Trip quá SLA:{' '}
              <strong className="text-danger">{summary.overdueTrips}</strong>
            </p>
          </section>
        ) : null}
        <section
          className="min-w-0 rounded-surface border border-border bg-surface p-4 sm:p-5"
          aria-labelledby="tower-priority"
        >
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="tower-priority" className="text-lg font-semibold">
                Danh sách vận hành
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ưu tiên: quá SLA → sắp quá SLA → aging lâu → exception chưa xử lý.
              </p>
              {data ? (
                <p className="mt-1 text-sm tabular-nums">{data.pagination.total} kết quả</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="tower-sort">
                  Sắp xếp
                </label>
                <Select
                  id="tower-sort"
                  value={sort}
                  onChange={(event) => change('sort', event.target.value)}
                >
                  {Object.entries(sortLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold" htmlFor="tower-limit">
                  Dòng / trang
                </label>
                <Select
                  id="tower-limit"
                  value={params.get('limit') ?? '25'}
                  onChange={(event) => change('limit', event.target.value)}
                >
                  {[10, 25, 50, 100].map((limit) => (
                    <option key={limit}>{limit}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
          <DataTable
            caption="Ưu tiên vận hành Control Tower"
            columns={columns}
            rows={data?.items ?? []}
            getRowKey={(row) => `${row.entityType}-${row.id}`}
            loading={tower.isPending}
            loadingLabel="Đang tải Control Tower"
            error={tower.isError ? getApiErrorMessage(tower.error) : undefined}
            onRetry={() => tower.refetch()}
            emptyTitle="Không có shipment / trip phù hợp"
            emptyDescription="Thử mở rộng bộ lọc hoặc xóa bộ lọc để xem các tác vụ đang hoạt động."
            wide
            getRowClassName={(row) =>
              row.slaState === 'OVERDUE'
                ? '[&>td]:bg-red-50/60'
                : row.slaState === 'AT_RISK'
                  ? '[&>td]:bg-orange-50/70'
                  : ''
            }
          />
          {data ? (
            <div className="mt-4">
              <Pagination
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                disabled={tower.isFetching}
                onPageChange={(page) => change('page', String(page))}
              />
            </div>
          ) : null}
          {data && data.pagination.page > Math.max(1, data.pagination.totalPages) ? (
            <Button className="mt-3" variant="secondary" onClick={() => change('page', '1')}>
              Về trang đầu
            </Button>
          ) : null}
        </section>
        {data ? (
          <details className="rounded-surface border border-border bg-surface p-4 text-sm leading-6">
            <summary className="focus-ring min-h-11 cursor-pointer font-semibold">
              Chính sách SLA đang áp dụng
            </summary>
            <p>
              Ngưỡng vận hành mặc định, tính liên tục 24/7. Sắp quá SLA từ{' '}
              {data.policy.atRiskPercent}% thời lượng; cảnh báo aging từ{' '}
              {agingLabel(data.policy.agingAlertMinutes * 60)}.
            </p>
            <ul className="mt-2 grid list-inside list-disc gap-x-6 sm:grid-cols-2">
              {Object.entries(data.policy.durationMinutes).map(([stage, minutes]) => (
                <li key={stage}>
                  {stageLabels[stage] ?? stage}: {agingLabel(minutes * 60)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              Aging tính từ lần vào stage hiện tại. Phân công lại trong cùng stage không reset SLA.
              Pending, exception và Trip chưa khởi hành chưa áp dụng SLA. Thiếu hoặc mâu thuẫn mốc
              thời gian được ghi rõ để kiểm tra.
            </p>
          </details>
        ) : null}
      </main>
    </AccountLayout>
  );
}
