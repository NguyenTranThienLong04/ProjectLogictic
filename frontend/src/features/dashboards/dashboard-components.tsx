import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { ShipmentStatusBadge } from '../../components/ui/status-badge';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import type { DashboardOverview, DashboardShipmentSummary } from './dashboard-api';

const integerFormatter = new Intl.NumberFormat('vi-VN');
const percentFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

function durationLabel(hours: number): string {
  if (hours < 1) return `${integerFormatter.format(Math.round(hours * 60))} phút`;
  return `${percentFormatter.format(hours)} giờ`;
}

export function MetricCard({
  detail,
  label,
  tone = 'primary',
  value,
}: {
  detail?: string;
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'slate';
  value: string;
}) {
  const toneClass = {
    primary: 'border-l-primary',
    success: 'border-l-success',
    warning: 'border-l-warning',
    danger: 'border-l-danger',
    slate: 'border-l-slate-400',
  }[tone];
  return (
    <article
      className={`rounded-surface border border-l-4 border-border bg-surface p-4 shadow-surface ${toneClass}`}
    >
      <p className="text-sm font-semibold leading-5 text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p> : null}
    </article>
  );
}

export function DashboardOverviewGrid({ overview }: { overview: DashboardOverview }) {
  const metrics = [
    ['Tổng vận đơn', integerFormatter.format(overview.totalShipments), 'primary'],
    ['Chờ xác nhận', integerFormatter.format(overview.pending), 'warning'],
    ['Đang trung chuyển', integerFormatter.format(overview.inTransit), 'primary'],
    ['Đang giao', integerFormatter.format(overview.outForDelivery), 'primary'],
    ['Đã giao', integerFormatter.format(overview.delivered), 'success'],
    ['Giao chưa thành công', integerFormatter.format(overview.failed), 'danger'],
    ['Đã hủy', integerFormatter.format(overview.cancelled), 'slate'],
    ['Tỷ lệ giao thành công', `${percentFormatter.format(overview.deliverySuccessRate)}%`, 'success'],
    ['Thời gian giao trung bình', durationLabel(overview.averageDeliveryTimeHours), 'primary'],
    ['COD đã thu', vndFormatter.format(overview.codCollected), 'warning'],
    ['COD chưa quyết toán', vndFormatter.format(overview.codUnsettled), 'warning'],
  ] as const;
  return (
    <section aria-labelledby="dashboard-overview-heading">
      <h2 className="text-lg font-semibold text-ink" id="dashboard-overview-heading">
        Tổng quan vận hành
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {metrics.map(([label, value, tone]) => (
          <MetricCard key={label} label={label} tone={tone} value={value} />
        ))}
      </div>
    </section>
  );
}

const recentShipmentColumns: DataTableColumn<DashboardShipmentSummary>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    render: (row) => (
      <Link
        className="focus-ring rounded-control font-mono font-semibold text-primary hover:underline"
        to={`/shipments/${row.id}`}
      >
        {row.trackingCode}
      </Link>
    ),
  },
  {
    id: 'status',
    header: 'Trạng thái',
    render: (row) => <ShipmentStatusBadge status={row.status} />,
  },
  { id: 'receiver', header: 'Người nhận', render: (row) => row.receiverName },
  { id: 'destination', header: 'Điểm đến', render: (row) => row.deliveryCity },
  {
    id: 'createdAt',
    header: 'Tạo lúc',
    render: (row) => dateTimeFormatter.format(new Date(row.createdAt)),
  },
];

export function RecentShipmentsTable({
  linkForRow,
  rows,
}: {
  linkForRow?: (row: DashboardShipmentSummary) => string;
  rows: DashboardShipmentSummary[];
}) {
  const columns = linkForRow
    ? recentShipmentColumns.map((column) =>
        column.id === 'trackingCode'
          ? {
              ...column,
              render: (row: DashboardShipmentSummary) => (
                <Link
                  className="focus-ring rounded-control font-mono font-semibold text-primary hover:underline"
                  to={linkForRow(row)}
                >
                  {row.trackingCode}
                </Link>
              ),
            }
          : column,
      )
    : recentShipmentColumns;
  return (
    <section className="mt-8 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5">
      <h2 className="text-lg font-semibold text-ink">Vận đơn gần đây</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Năm vận đơn mới nhất trong đúng phạm vi tài khoản.
      </p>
      <div className="mt-4">
        <DataTable
          caption="Vận đơn gần đây"
          columns={columns}
          emptyTitle="Chưa có vận đơn"
          getRowKey={(row) => row.id}
          rows={rows}
        />
      </div>
    </section>
  );
}
