import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../components/ui/data-table';
import { PageHeader } from '../../../components/ui/page-header';
import { Pagination } from '../../../components/ui/pagination';
import { SearchFilter } from '../../../components/ui/search-filter';
import { Select } from '../../../components/ui/select';
import { ShipmentStatusBadge } from '../../../components/ui/status-badge';
import { getApiErrorMessage } from '../../../services/api-error';
import { vndFormatter } from '../../../utils/format';
import { AccountLayout } from '../../auth/components/account-layout';
import { getMyStaffProfile, listWarehouseExceptions } from '../warehouses-api';
import type { WarehouseShipment } from '../warehouse-types';

const columns: DataTableColumn<WarehouseShipment>[] = [
  { id: 'trackingCode', header: 'Mã vận đơn', render: (row) => <span className="font-mono font-semibold text-primary">{row.trackingCode}</span> },
  { id: 'status', header: 'Ngoại lệ', render: (row) => <ShipmentStatusBadge status={row.status} /> },
  { id: 'receiver', header: 'Người nhận', render: (row) => row.receiverSnapshot.fullName },
  { id: 'package', header: 'Kiện hàng', render: (row) => row.packageSnapshot.description },
  { id: 'cod', header: 'COD', align: 'right', render: (row) => <span className="tabular-nums">{vndFormatter.format(row.codAmount)}</span> },
];

export function WarehouseExceptionsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const status = (params.get('status') || '') as '' | 'DAMAGED' | 'LOST';
  const profile = useQuery({ queryKey: ['warehouse-staff-profile'], queryFn: getMyStaffProfile });
  const exceptions = useQuery({
    queryKey: ['warehouse-exceptions', profile.data?.warehouseId, { page, search, status }],
    queryFn: () => listWarehouseExceptions(profile.data!.warehouseId, { page, search: search || undefined, status: status || undefined }),
    enabled: Boolean(profile.data?.warehouseId),
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
          description="Danh sách hư hỏng hoặc thất lạc đang thuộc đúng kho được phân công; màn này không tạo transition mới."
          eyebrow="Warehouse workspace"
          title="Ngoại lệ kho"
        />
        <div className="mt-6">
          <SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Tìm mã vận đơn hoặc khách hàng" value={search}>
            <label className="min-w-48 text-sm font-semibold text-ink">Loại ngoại lệ<Select className="mt-1.5" onChange={(event) => update('status', event.target.value)} value={status}><option value="">Tất cả</option><option value="DAMAGED">Hàng hư hỏng</option><option value="LOST">Thất lạc</option></Select></label>
          </SearchFilter>
        </div>
        <div className="mt-6">
          <DataTable
            caption="Ngoại lệ tại kho được phân công"
            columns={columns}
            emptyDescription="Không có kiện hư hỏng hoặc thất lạc đang thuộc kho này."
            emptyTitle="Không có ngoại lệ kho"
            error={profile.isError ? getApiErrorMessage(profile.error) : exceptions.isError ? getApiErrorMessage(exceptions.error) : undefined}
            getRowKey={(row) => row.id}
            loading={profile.isPending || exceptions.isPending}
            loadingLabel="Đang tải ngoại lệ kho"
            onRetry={() => { void profile.refetch(); void exceptions.refetch(); }}
            rows={exceptions.data?.items ?? []}
          />
        </div>
        {exceptions.data ? <div className="mt-5"><Pagination disabled={exceptions.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={exceptions.data.page} totalPages={exceptions.data.totalPages} /></div> : null}
      </main>
    </AccountLayout>
  );
}
