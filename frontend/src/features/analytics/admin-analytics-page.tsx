import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { SelectField } from '../../components/ui/select-field';
import {
  DeliveryFailureReasonBadge,
  ShipmentStatusBadge,
} from '../../components/ui/status-badge';
import {
  deliveryFailureReasonBadgeConfig,
  shipmentStatusBadgeConfig,
} from '../../components/ui/status-badge-config';
import type {
  DeliveryFailureReasonBadgeStatus,
  ShipmentBadgeStatus,
} from '../../components/ui/status-badge-config';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import {
  type AnalyticsFilters,
  type AnalyticsGranularity,
  type AnalyticsDashboard,
  getAnalytics,
} from './analytics-api';

const integerFormatter = new Intl.NumberFormat('vi-VN');
const percentFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const shortDateFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });

type MetricTone = 'blue' | 'green' | 'amber' | 'red' | 'slate';

const metricTones: Record<MetricTone, string> = {
  blue: 'border-l-primary',
  green: 'border-l-success',
  amber: 'border-l-warning',
  red: 'border-l-danger',
  slate: 'border-l-slate-400',
};

type TrendRow = AnalyticsDashboard['shipmentTrend'][number] & { label: string };
type StatusRow = AnalyticsDashboard['statusBreakdown'][number] & { label: string };
type FailureRow = AnalyticsDashboard['failedDeliveryStats']['byReason'][number] & {
  label: string;
};

function isShipmentBadgeStatus(status: string): status is ShipmentBadgeStatus {
  return status in shipmentStatusBadgeConfig;
}

function isFailureBadgeStatus(reason: string): reason is DeliveryFailureReasonBadgeStatus {
  return reason in deliveryFailureReasonBadgeConfig;
}

function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function defaultFilters(): AnalyticsFilters {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return {
    from: dateInputValue(from),
    to: dateInputValue(to),
    warehouseId: '',
    driverId: '',
    granularity: 'day',
  };
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${integerFormatter.format(Math.round(hours * 60))} phút`;
  return `${percentFormatter.format(hours)} giờ`;
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'blue',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: MetricTone;
}) {
  return (
    <article
      className={`rounded-surface border border-l-4 border-border bg-surface p-4 text-ink shadow-surface ${metricTones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-5 text-muted-foreground">{label}</p>
        <svg
          aria-hidden="true"
          className="size-5 shrink-0 opacity-70"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
        </svg>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p> : null}
    </article>
  );
}

function ChartSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const trendColumns: DataTableColumn<TrendRow>[] = [
  { id: 'period', header: 'Kỳ', render: (row) => row.label },
  {
    align: 'right',
    id: 'created',
    header: 'Tạo mới',
    render: (row) => <span className="tabular-nums">{row.created}</span>,
  },
  {
    align: 'right',
    id: 'delivered',
    header: 'Đã giao',
    render: (row) => <span className="tabular-nums text-success">{row.delivered}</span>,
  },
  {
    align: 'right',
    id: 'failed',
    header: 'Thất bại',
    render: (row) => <span className="tabular-nums text-danger">{row.failed}</span>,
  },
];

const statusColumns: DataTableColumn<StatusRow>[] = [
  {
    id: 'status',
    header: 'Trạng thái',
    render: (row) =>
      isShipmentBadgeStatus(row.status) ? (
        <ShipmentStatusBadge status={row.status} />
      ) : (
        row.label
      ),
  },
  {
    align: 'right',
    id: 'count',
    header: 'Vận đơn',
    render: (row) => <span className="font-semibold tabular-nums">{row.count}</span>,
  },
];

const failureColumns: DataTableColumn<FailureRow>[] = [
  {
    id: 'reason',
    header: 'Nguyên nhân',
    render: (row) =>
      isFailureBadgeStatus(row.reason) ? (
        <DeliveryFailureReasonBadge reason={row.reason} />
      ) : (
        row.label
      ),
  },
  {
    align: 'right',
    id: 'count',
    header: 'Lượt',
    render: (row) => <span className="tabular-nums">{row.count}</span>,
  },
  {
    align: 'right',
    id: 'percentage',
    header: 'Tỷ lệ',
    render: (row) => <span className="tabular-nums">{percentFormatter.format(row.percentage)}%</span>,
  },
];

const driverColumns: DataTableColumn<AnalyticsDashboard['driverPerformance'][number]>[] = [
  {
    id: 'driver',
    header: 'Tài xế',
    render: (driver) => (
      <span className="block">
        <span className="block font-semibold text-ink">{driver.driverName}</span>
        <span className="block font-mono text-xs text-muted-foreground">{driver.employeeCode}</span>
      </span>
    ),
  },
  { align: 'right', id: 'attempts', header: 'Tổng lượt', render: (driver) => <span className="tabular-nums">{driver.totalAttempts}</span> },
  { align: 'right', id: 'delivered', header: 'Đã giao', render: (driver) => <span className="tabular-nums text-success">{driver.delivered}</span> },
  { align: 'right', id: 'failed', header: 'Thất bại', render: (driver) => <span className="tabular-nums text-danger">{driver.failed}</span> },
  { align: 'right', id: 'rate', header: 'Tỷ lệ', render: (driver) => <span className="font-semibold tabular-nums">{percentFormatter.format(driver.successRate)}%</span> },
  { align: 'right', id: 'duration', header: 'Thời lượng TB', render: (driver) => <span className="tabular-nums">{formatDuration(driver.averageAttemptDurationHours)}</span> },
];

const warehouseColumns: DataTableColumn<AnalyticsDashboard['warehouseStats'][number]>[] = [
  {
    id: 'warehouse',
    header: 'Kho',
    render: (warehouse) => (
      <span className="block">
        <span className="block font-semibold text-ink">{warehouse.name}</span>
        <span className="block font-mono text-xs text-muted-foreground">{warehouse.code}</span>
      </span>
    ),
  },
  { align: 'right', id: 'inbound', header: 'Luồng vào', render: (warehouse) => <span className="tabular-nums">{warehouse.inboundShipments}</span> },
  { align: 'right', id: 'outbound', header: 'Luồng ra', render: (warehouse) => <span className="tabular-nums">{warehouse.outboundShipments}</span> },
  { align: 'right', id: 'inventory', header: 'Tồn hiện tại', render: (warehouse) => <span className="font-semibold tabular-nums text-primary">{warehouse.currentInventory}</span> },
  { align: 'right', id: 'dispatched', header: 'Transfer đi', render: (warehouse) => <span className="tabular-nums">{warehouse.transfersDispatched}</span> },
  { align: 'right', id: 'received', header: 'Transfer nhận', render: (warehouse) => <span className="tabular-nums">{warehouse.transfersReceived}</span> },
  { align: 'right', id: 'delivered', header: 'Đã giao', render: (warehouse) => <span className="tabular-nums text-success">{warehouse.deliveredShipments}</span> },
];

export function AdminAnalyticsPage() {
  const initialFilters = defaultFilters();
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
  const [draft, setDraft] = useState<AnalyticsFilters>(initialFilters);
  const [filterError, setFilterError] = useState('');
  const query = useQuery({
    queryKey: ['admin-analytics', filters],
    queryFn: () => getAnalytics(filters),
    placeholderData: (previous) => previous,
  });

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.from > draft.to) {
      setFilterError('Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.');
      return;
    }
    setFilterError('');
    setFilters({ ...draft });
  };

  const resetFilters = () => {
    const next = defaultFilters();
    setFilterError('');
    setDraft(next);
    setFilters(next);
  };

  if (query.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tổng hợp dữ liệu vận hành từ PostgreSQL" />
      </AccountLayout>
    );
  }

  const data = query.data;
  const statusChart =
    data?.statusBreakdown.map((item) => ({
      ...item,
      label: isShipmentBadgeStatus(item.status)
        ? shipmentStatusBadgeConfig[item.status].label
        : item.status,
    })) ?? [];
  const failedChart =
    data?.failedDeliveryStats.byReason.map((item) => ({
      ...item,
      label: isFailureBadgeStatus(item.reason)
        ? deliveryFailureReasonBadgeConfig[item.reason].label
        : item.reason,
    })) ?? [];
  const trend =
    data?.shipmentTrend.map((item) => ({
      ...item,
      label: shortDateFormatter.format(new Date(item.period)),
    })) ?? [];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Theo dõi luồng vận đơn, chất lượng giao hàng, tài xế, kho và đối soát COD trong một phạm vi dữ liệu nhất quán."
          eyebrow="Quản trị · Analytics"
          meta={
            data ? (
              <span className="text-xs font-medium text-muted-foreground" role="status">
                Cập nhật {dateTimeFormatter.format(new Date(data.generatedAt))}
              </span>
            ) : null
          }
          title="Hiệu suất vận hành"
        />

        <section className="mt-6 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Bộ lọc báo cáo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tối đa 366 ngày; phạm vi kho và tài xế áp dụng xuyên suốt toàn bộ dashboard.
              </p>
            </div>
            {query.isFetching ? (
              <span className="text-sm font-bold text-primary" role="status">
                Đang cập nhật số liệu…
              </span>
            ) : null}
          </div>
          <form className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" onSubmit={applyFilters}>
            <FormField
              id="analytics-from"
              label="Từ ngày"
              max={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              required
              type="date"
              value={draft.from}
            />
            <FormField
              id="analytics-to"
              label="Đến ngày"
              min={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              required
              type="date"
              value={draft.to}
            />
            <SelectField
              id="analytics-warehouse"
              label="Kho hàng"
              onChange={(event) =>
                setDraft((current) => ({ ...current, warehouseId: event.target.value }))
              }
              value={draft.warehouseId}
            >
              <option value="">Tất cả kho</option>
              {data?.filterOptions.warehouses.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="analytics-driver"
              label="Tài xế"
              onChange={(event) =>
                setDraft((current) => ({ ...current, driverId: event.target.value }))
              }
              value={draft.driverId}
            >
              <option value="">Tất cả tài xế</option>
              {data?.filterOptions.drivers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="analytics-granularity"
              label="Nhóm thời gian"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  granularity: event.target.value as AnalyticsGranularity,
                }))
              }
              value={draft.granularity}
            >
              <option value="day">Theo ngày</option>
              <option value="week">Theo tuần</option>
              <option value="month">Theo tháng</option>
            </SelectField>
            <div className="md:col-span-2 lg:col-span-3 xl:col-span-5">
              <ErrorSummary message={filterError || undefined} />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <Button className="w-full sm:w-auto" loading={query.isFetching} type="submit">
                  Áp dụng bộ lọc
                </Button>
                <Button className="w-full sm:w-auto" onClick={resetFilters} type="button" variant="secondary">
                  Đặt lại 30 ngày
                </Button>
              </div>
            </div>
          </form>
        </section>

        {query.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(query.error)}
              onRetry={() => query.refetch()}
            />
          </div>
        ) : data ? (
          <>
            <section aria-labelledby="overview-title" className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-ink" id="overview-title">
                  Tổng quan vận đơn
                </h2>
                <span className="rounded-full border border-border-strong bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                  {data.filters.from} → {data.filters.to}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Tổng vận đơn" tone="blue" value={integerFormatter.format(data.overview.totalShipments)} />
                <MetricCard label="Chờ xác nhận" tone="amber" value={integerFormatter.format(data.overview.pending)} />
                <MetricCard label="Đang trung chuyển" value={integerFormatter.format(data.overview.inTransit)} />
                <MetricCard label="Đang giao" tone="amber" value={integerFormatter.format(data.overview.outForDelivery)} />
                <MetricCard label="Đã giao" tone="green" value={integerFormatter.format(data.overview.delivered)} />
                <MetricCard label="Giao thất bại" tone="red" value={integerFormatter.format(data.overview.failed)} />
                <MetricCard label="Đã hủy" tone="slate" value={integerFormatter.format(data.overview.cancelled)} />
                <MetricCard label="Tỷ lệ giao thành công" tone="green" value={`${percentFormatter.format(data.overview.deliverySuccessRate)}%`} />
                <MetricCard label="Thời gian giao trung bình" detail="Từ lúc tạo đến khi giao thành công" value={formatDuration(data.overview.averageDeliveryTimeHours)} />
                <MetricCard label="COD đã thu" tone="green" value={vndFormatter.format(data.codStats.collectedAmount)} />
                <MetricCard label="COD chưa quyết toán" tone="amber" value={vndFormatter.format(data.codStats.unsettledAmount)} />
                <MetricCard label="COD tranh chấp" tone="red" value={vndFormatter.format(data.codStats.disputedAmount)} />
              </div>
            </section>

            {data.overview.totalShipments === 0 ? (
              <div className="mt-8">
                <EmptyState
                  description="Hãy mở rộng khoảng ngày hoặc bỏ bớt bộ lọc kho và tài xế."
                  title="Không có dữ liệu trong phạm vi đã chọn"
                />
              </div>
            ) : (
              <>
                <div className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
                  <ChartSection
                    description="Số vận đơn tạo mới, giao thành công và giao thất bại theo kỳ."
                    title="Xu hướng vận đơn"
                  >
                    <div aria-label="Biểu đồ xu hướng vận đơn theo thời gian" className="h-72 sm:h-80" role="img">
                      <ResponsiveContainer height="100%" width="100%">
                        <LineChart accessibilityLayer data={trend} margin={{ left: -16, right: 12 }}>
                          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" minTickGap={24} stroke="var(--color-muted-foreground)" />
                          <YAxis allowDecimals={false} stroke="var(--color-muted-foreground)" />
                          <Tooltip />
                          <Legend />
                          <Line dataKey="created" dot={false} name="Tạo mới" stroke="var(--color-primary)" strokeWidth={2.5} type="monotone" />
                          <Line dataKey="delivered" dot={false} name="Đã giao" stroke="var(--color-success)" strokeDasharray="8 4" strokeWidth={2.5} type="monotone" />
                          <Line dataKey="failed" dot={false} name="Thất bại" stroke="var(--color-danger)" strokeDasharray="2 4" strokeWidth={2.5} type="monotone" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <details className="mt-4 rounded-control border border-border bg-surface-subtle p-3">
                      <summary className="focus-ring flex min-h-11 cursor-pointer items-center rounded-control font-semibold text-primary">
                        Xem bảng dữ liệu xu hướng
                      </summary>
                      <div className="mt-3">
                        <DataTable
                          caption="Dữ liệu xu hướng vận đơn"
                          columns={trendColumns}
                          getRowKey={(row) => row.period}
                          rows={trend}
                        />
                      </div>
                    </details>
                  </ChartSection>

                  <ChartSection
                    description="Phân bố trạng thái hiện tại của các vận đơn trong phạm vi."
                    title="Cơ cấu trạng thái"
                  >
                    <div aria-label="Biểu đồ số vận đơn theo trạng thái" className="h-72 sm:h-80" role="img">
                      <ResponsiveContainer height="100%" width="100%">
                        <BarChart accessibilityLayer data={statusChart.slice(0, 10)} layout="vertical" margin={{ left: 18 }}>
                          <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                          <XAxis allowDecimals={false} stroke="var(--color-muted-foreground)" type="number" />
                          <YAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 11 }} type="category" width={112} />
                          <Tooltip />
                          <Bar dataKey="count" fill="var(--color-primary)" name="Vận đơn" radius={[0, 6, 6, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <details className="mt-4 rounded-control border border-border bg-surface-subtle p-3">
                      <summary className="focus-ring flex min-h-11 cursor-pointer items-center rounded-control font-semibold text-primary">
                        Xem bảng trạng thái đầy đủ
                      </summary>
                      <div className="mt-3">
                        <DataTable
                          caption="Phân bố trạng thái vận đơn"
                          columns={statusColumns}
                          getRowKey={(row) => row.status}
                          rows={statusChart}
                        />
                      </div>
                    </details>
                  </ChartSection>
                </div>

                <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-labelledby="delivery-performance-title">
                  <h2 className="text-xl font-semibold text-ink sm:col-span-2 lg:col-span-4" id="delivery-performance-title">Hiệu suất giao hàng</h2>
                  <MetricCard label="Tổng lượt giao" value={integerFormatter.format(data.deliveryPerformance.totalAttempts)} />
                  <MetricCard label="Thành công lần đầu" tone="green" value={`${percentFormatter.format(data.deliveryPerformance.firstAttemptSuccessRate)}%`} />
                  <MetricCard label="Lượt giao thất bại" tone="red" value={integerFormatter.format(data.deliveryPerformance.failedAttempts)} />
                  <MetricCard label="Thời lượng một lượt giao" value={formatDuration(data.deliveryPerformance.averageAttemptDurationHours)} />
                </section>

                <div className="mt-8 grid gap-6 lg:grid-cols-2">
                  <ChartSection
                    description={`${integerFormatter.format(data.failedDeliveryStats.totalFailures)} lượt thất bại trên ${integerFormatter.format(data.failedDeliveryStats.affectedShipments)} vận đơn.`}
                    title="Nguyên nhân giao thất bại"
                  >
                    {failedChart.length ? (
                      <>
                        <div aria-label="Biểu đồ nguyên nhân giao thất bại" className="h-64 sm:h-72" role="img">
                          <ResponsiveContainer height="100%" width="100%">
                            <BarChart accessibilityLayer data={failedChart} layout="vertical" margin={{ left: 28 }}>
                              <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                              <XAxis allowDecimals={false} stroke="var(--color-muted-foreground)" type="number" />
                              <YAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 11 }} type="category" width={132} />
                              <Tooltip />
                              <Bar dataKey="count" fill="var(--color-danger)" name="Lượt thất bại" radius={[0, 6, 6, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-3">
                          <DataTable
                            caption="Nguyên nhân giao thất bại"
                            columns={failureColumns}
                            getRowKey={(row) => row.reason}
                            rows={failedChart}
                          />
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        compact
                        description="Không ghi nhận lần giao thất bại trong phạm vi báo cáo."
                        title="Không có lượt giao thất bại"
                      />
                    )}
                  </ChartSection>

                  <ChartSection
                    description="Giá trị COD theo trạng thái thu, nộp và quyết toán."
                    title="Đối soát COD"
                  >
                    <dl className="grid gap-3 sm:grid-cols-2">
                      {[
                        ['Phải thu', data.codStats.expectedAmount],
                        ['Đã thu', data.codStats.collectedAmount],
                        ['Đã nộp', data.codStats.remittedAmount],
                        ['Đã quyết toán', data.codStats.settledAmount],
                      ].map(([label, amount]) => (
                        <div className="rounded-control border border-border bg-surface-subtle p-4" key={label}>
                          <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
                          <dd className="mt-2 font-bold tabular-nums text-ink">{vndFormatter.format(amount as number)}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-4 text-sm font-semibold text-muted-foreground">
                      {integerFormatter.format(data.codStats.transactionCount)} giao dịch COD trong phạm vi lọc.
                    </p>
                  </ChartSection>
                </div>

                <section className="mt-8 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5" aria-labelledby="driver-performance-title">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-ink" id="driver-performance-title">Hiệu suất tài xế</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Xếp hạng theo số lượt giao thành công, tối đa 20 tài xế trong phạm vi.</p>
                  </div>
                  <DataTable
                    caption="Hiệu suất giao hàng theo tài xế"
                    columns={driverColumns}
                    emptyDescription="Thử mở rộng khoảng ngày hoặc bỏ bộ lọc tài xế."
                    emptyTitle="Chưa có lượt giao của tài xế trong kỳ"
                    getRowKey={(driver) => driver.driverId}
                    rows={data.driverPerformance}
                  />
                </section>

                <section className="mt-8 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5" aria-labelledby="warehouse-stats-title">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-ink" id="warehouse-stats-title">Thống kê kho hàng</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Luồng vào/ra, tồn hiện tại và giao nhận transfer theo từng kho.</p>
                  </div>
                  <DataTable
                    caption="Thống kê vận hành theo kho"
                    columns={warehouseColumns}
                    emptyDescription="Thử mở rộng khoảng ngày hoặc bỏ bộ lọc kho."
                    emptyTitle="Chưa có hoạt động kho trong kỳ"
                    getRowKey={(warehouse) => warehouse.warehouseId}
                    rows={data.warehouseStats}
                  />
                </section>
              </>
            )}
          </>
        ) : null}
      </div>
    </AccountLayout>
  );
}
