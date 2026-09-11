import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { DeliveryFailureReasonBadge, ShipmentStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listMyDeliveryAssignments } from './operations-api';
import type { DeliveryAssignment } from './operations-types';

const columns: DataTableColumn<DeliveryAssignment>[] = [
  { id: 'trackingCode', header: 'Mã vận đơn', render: (row) => <Link className="focus-ring rounded-control font-mono font-semibold text-primary hover:underline" to={`/driver/deliveries/${row.id}`}>{row.trackingCode}</Link> },
  { id: 'status', header: 'Trạng thái', render: (row) => <ShipmentStatusBadge status={row.shipmentStatus} /> },
  { id: 'attempt', header: 'Lần giao', render: (row) => row.attempt ? `Lần ${row.attempt.attemptNumber}` : 'Chưa bắt đầu' },
  { id: 'result', header: 'Kết quả', render: (row) => row.attempt?.failureReason ? <DeliveryFailureReasonBadge reason={row.attempt.failureReason} /> : row.attempt?.status === 'DELIVERED' ? 'Giao thành công' : 'Không có kết quả' },
  { id: 'assignedAt', header: 'Phân công lúc', render: (row) => dateTimeFormatter.format(new Date(row.assignedAt)) },
];

export function DeliveryHistoryPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const attemptStatus = (params.get('result') || '') as '' | 'DELIVERED' | 'FAILED';
  const fromDate = params.get('from') ?? '';
  const toDate = params.get('to') ?? '';
  const history = useQuery({
    queryKey: ['driver-delivery-history', { page, search, attemptStatus, fromDate, toDate }],
    queryFn: () => listMyDeliveryAssignments({ view: 'HISTORY', page, search: search || undefined, attemptStatus: attemptStatus || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  };
  return (
    <AccountLayout>
      <main className="mx-auto max-w-6xl">
        <PageHeader
          actions={<Link className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink" to="/driver/deliveries">Nhiệm vụ hiện tại</Link>}
          description="Lịch sử giao thành công và thất bại, phân trang và lọc tại backend."
          eyebrow="Driver mobile workspace"
          title="Lịch sử giao hàng"
        />
        <div className="mt-6">
          <SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Tìm mã vận đơn" value={search}>
            <label className="min-w-44 text-sm font-semibold text-ink">Kết quả<Select className="mt-1.5" onChange={(event) => update('result', event.target.value)} value={attemptStatus}><option value="">Tất cả</option><option value="DELIVERED">Giao thành công</option><option value="FAILED">Giao thất bại</option></Select></label>
            <label className="text-sm font-semibold text-ink">Từ ngày<Input className="mt-1.5" onChange={(event) => update('from', event.target.value)} type="date" value={fromDate} /></label>
            <label className="text-sm font-semibold text-ink">Đến ngày<Input className="mt-1.5" onChange={(event) => update('to', event.target.value)} type="date" value={toDate} /></label>
          </SearchFilter>
        </div>
        <div className="mt-6"><DataTable caption="Lịch sử giao hàng" columns={columns} emptyTitle="Chưa có lịch sử giao hàng" error={history.isError ? getApiErrorMessage(history.error) : undefined} getRowKey={(row) => row.id} loading={history.isPending} onRetry={() => void history.refetch()} rows={history.data?.items ?? []} /></div>
        {history.data ? <div className="mt-5"><Pagination disabled={history.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={history.data.page} totalPages={history.data.totalPages} /></div> : null}
      </main>
    </AccountLayout>
  );
}
