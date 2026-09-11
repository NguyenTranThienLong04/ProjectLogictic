import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { StatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listDrivers } from './operations-api';
import type { DriverProfile, DriverStatus } from './operations-types';

const statusLabels: Record<DriverStatus, string> = { AVAILABLE: 'Sẵn sàng', BUSY: 'Đang bận', OFFLINE: 'Ngoại tuyến', SUSPENDED: 'Tạm khóa' };
const statusAppearance: Record<DriverStatus, { label: string; surface: string; dot: string }> = {
  AVAILABLE: { label: statusLabels.AVAILABLE, surface: 'border-success/30 bg-success-soft text-success', dot: 'bg-success' },
  BUSY: { label: statusLabels.BUSY, surface: 'border-warning/30 bg-warning-soft text-warning', dot: 'bg-warning' },
  OFFLINE: { label: statusLabels.OFFLINE, surface: 'border-border bg-surface-muted text-muted-foreground', dot: 'bg-slate-400' },
  SUSPENDED: { label: statusLabels.SUSPENDED, surface: 'border-danger/30 bg-red-50 text-danger', dot: 'bg-danger' },
};
const columns: DataTableColumn<DriverProfile>[] = [
  { id: 'driver', header: 'Tài xế', render: (row) => <div><p className="font-semibold text-ink">{row.fullName}</p><p className="text-xs text-muted-foreground">{row.employeeCode}</p></div> },
  { id: 'status', header: 'Trạng thái', render: (row) => <StatusBadge appearance={statusAppearance[row.status]} /> },
  { id: 'vehicle', header: 'Phương tiện', render: (row) => `${row.vehicleType} · ${row.vehiclePlate}` },
  { id: 'contact', header: 'Liên hệ', render: (row) => row.email },
  { id: 'updatedAt', header: 'Cập nhật', render: (row) => dateTimeFormatter.format(new Date(row.updatedAt)) },
];

export function DriverAvailabilityPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const status = (params.get('status') || '') as DriverStatus | '';
  const drivers = useQuery({
    queryKey: ['drivers', { page, search, status }],
    queryFn: () => listDrivers({ page, search: search || undefined, status: status || undefined }),
    refetchInterval: 20_000,
  });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.set('page', '1'); setParams(next); };
  return (
    <AccountLayout>
      <main className="mx-auto max-w-6xl">
        <PageHeader actions={<Link className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink" to="/dispatcher/drivers/map">Mở bản đồ</Link>} description="Tìm kiếm và theo dõi trạng thái nhận việc của toàn bộ tài xế; tự làm mới mỗi 20 giây." eyebrow="Dispatcher workspace" title="Tài xế sẵn sàng" />
        <div className="mt-6"><SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Tên, email, mã nhân viên hoặc biển số" value={search}><label className="min-w-48 text-sm font-semibold text-ink">Trạng thái<Select className="mt-1.5" onChange={(event) => update('status', event.target.value)} value={status}><option value="">Tất cả</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></SearchFilter></div>
        <div className="mt-6"><DataTable caption="Khả dụng tài xế" columns={columns} emptyTitle="Không có tài xế phù hợp" error={drivers.isError ? getApiErrorMessage(drivers.error) : undefined} getRowKey={(row) => row.id} loading={drivers.isPending} onRetry={() => void drivers.refetch()} rows={drivers.data?.items ?? []} /></div>
        {drivers.data ? <div className="mt-5"><Pagination disabled={drivers.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={drivers.data.page} totalPages={drivers.data.totalPages} /></div> : null}
      </main>
    </AccountLayout>
  );
}
