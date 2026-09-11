import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listMyAssignments } from './operations-api';
import type { Assignment, AssignmentStatus } from './operations-types';

const labels: Record<AssignmentStatus, string> = {
  PENDING: 'Chờ phản hồi',
  ACCEPTED: 'Đang thực hiện',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Đã lấy hàng',
  CANCELLED: 'Đã thay thế',
};

const columns: DataTableColumn<Assignment>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    render: (row) => <span className="font-mono font-semibold text-primary">{row.trackingCode}</span>,
  },
  { id: 'receiver', header: 'Người nhận', render: (row) => row.receiver.fullName },
  {
    id: 'pickup',
    header: 'Điểm lấy',
    render: (row) => `${row.pickup.streetAddress}, ${row.pickup.district}, ${row.pickup.city}`,
  },
  { id: 'status', header: 'Trạng thái', render: (row) => labels[row.status] },
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
        to={`/driver/pickups/${row.id}`}
      >
        Mở chi tiết
      </Link>
    ),
  },
];

export function DriverAssignmentsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = (params.get('status') || '') as AssignmentStatus | '';
  const search = params.get('search') ?? '';
  const assignments = useQuery({
    queryKey: ['driver-assignments', { page, status, search }],
    queryFn: () =>
      listMyAssignments({ page, status: status || undefined, search: search || undefined }),
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
          description="Danh sách phân trang; mở từng nhiệm vụ để nhận, từ chối hoặc xác nhận lấy hàng."
          eyebrow="Driver mobile workspace"
          title="Nhiệm vụ lấy hàng"
        />
        <div className="mt-6">
          <SearchFilter
            disabled={assignments.isFetching}
            onChange={(value) => update('search', value)}
            onClear={() => update('search', '')}
            placeholder="Tìm mã vận đơn"
            value={search}
          >
            <label className="min-w-48 text-sm font-semibold text-ink">
              Trạng thái
              <Select
                className="mt-1.5"
                onChange={(event) => update('status', event.target.value)}
                value={status}
              >
                <option value="">Tất cả</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </label>
          </SearchFilter>
        </div>
        <div className="mt-6">
          <DataTable
            caption="Nhiệm vụ lấy hàng"
            columns={columns}
            emptyDescription="Nhiệm vụ mới sẽ xuất hiện sau khi Dispatcher phân công."
            emptyTitle="Chưa có nhiệm vụ lấy hàng"
            error={assignments.isError ? getApiErrorMessage(assignments.error) : undefined}
            getRowKey={(row) => row.id}
            loading={assignments.isPending}
            loadingLabel="Đang tải nhiệm vụ lấy hàng"
            onRetry={() => void assignments.refetch()}
            rows={assignments.data?.items ?? []}
          />
        </div>
        {assignments.data ? (
          <div className="mt-5">
            <Pagination
              disabled={assignments.isFetching}
              onPageChange={(nextPage) => update('page', String(nextPage))}
              page={assignments.data.page}
              totalPages={assignments.data.totalPages}
            />
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
