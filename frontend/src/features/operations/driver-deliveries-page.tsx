import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { ShipmentStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listMyDeliveryAssignments } from './operations-api';
import type { DeliveryAssignment } from './operations-types';

const columns: DataTableColumn<DeliveryAssignment>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    render: (row) => <span className="font-mono font-semibold text-primary">{row.trackingCode}</span>,
  },
  { id: 'receiver', header: 'Người nhận', render: (row) => row.receiver.fullName },
  { id: 'destination', header: 'Điểm giao', render: (row) => `${row.delivery.district}, ${row.delivery.city}` },
  { id: 'status', header: 'Trạng thái', render: (row) => <ShipmentStatusBadge status={row.shipmentStatus} /> },
  {
    id: 'assignedAt',
    header: 'Phân công lúc',
    render: (row) => dateTimeFormatter.format(new Date(row.assignedAt)),
  },
  {
    id: 'action',
    header: 'Thao tác',
    render: (row) => (
      <Link
        className="focus-ring ui-transition inline-flex min-h-12 items-center rounded-control bg-primary px-4 font-semibold text-on-primary transition-colors hover:bg-primary-strong"
        to={`/driver/deliveries/${row.id}`}
      >
        Mở chi tiết
      </Link>
    ),
  },
];

export function DriverDeliveriesPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const deliveries = useQuery({
    queryKey: ['driver-deliveries', { page, search }],
    queryFn: () =>
      listMyDeliveryAssignments({ view: 'ACTIVE', page, search: search || undefined }),
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
      <main className="mx-auto max-w-5xl">
        <PageHeader
          actions={
            <Link
              className="focus-ring inline-flex min-h-12 items-center rounded-control border border-border bg-surface px-4 font-semibold text-ink"
              to="/driver/delivery-history"
            >
              Lịch sử giao
            </Link>
          }
          description="Mở từng nhiệm vụ để bắt đầu giao, ghi nhận POD hoặc báo giao thất bại."
          eyebrow="Driver mobile workspace"
          title="Nhiệm vụ giao hàng"
        />
        <div className="mt-6">
          <SearchFilter
            disabled={deliveries.isFetching}
            onChange={(value) => update('search', value)}
            onClear={() => update('search', '')}
            placeholder="Tìm mã vận đơn"
            value={search}
          />
        </div>
        <div className="mt-6">
          <DataTable
            caption="Nhiệm vụ giao hàng đang hoạt động"
            columns={columns}
            emptyDescription="Nhiệm vụ mới sẽ xuất hiện sau khi Dispatcher phân công."
            emptyTitle="Chưa có nhiệm vụ giao hàng"
            error={deliveries.isError ? getApiErrorMessage(deliveries.error) : undefined}
            getRowKey={(row) => row.id}
            loading={deliveries.isPending}
            loadingLabel="Đang tải nhiệm vụ giao hàng"
            onRetry={() => void deliveries.refetch()}
            rows={deliveries.data?.items ?? []}
          />
        </div>
        {deliveries.data ? (
          <div className="mt-5">
            <Pagination
              disabled={deliveries.isFetching}
              onPageChange={(nextPage) => update('page', String(nextPage))}
              page={deliveries.data.page}
              totalPages={deliveries.data.totalPages}
            />
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
