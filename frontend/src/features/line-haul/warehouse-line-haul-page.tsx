import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { SelectField } from '../../components/ui/select-field';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { formatDateTime } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { getMyStaffProfile } from '../warehouses/warehouses-api';
import { CapacityIndicator } from './capacity-indicator';
import { listLineHaulTrips } from './line-haul-api';
import { LineHaulScheduleBoard } from './line-haul-schedule-board';
import type { LineHaulTrip, LineHaulTripStatus } from './line-haul-types';

export function WarehouseLineHaulPage() {
  const [status, setStatus] = useState<LineHaulTripStatus | ''>('');
  const profile = useQuery({
    queryKey: ['warehouse-staff-me'],
    queryFn: getMyStaffProfile,
  });
  const trips = useQuery({
    queryKey: ['warehouse-line-haul-trips', status],
    queryFn: () => listLineHaulTrips({ status: status || undefined, page: 1, limit: 50 }),
  });

  if (profile.isPending || trips.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải các chuyến liên kho của kho" />
      </AccountLayout>
    );
  }
  if (profile.isError || trips.isError) {
    return (
      <AccountLayout>
        <ErrorState
          message={getApiErrorMessage(profile.error ?? trips.error)}
          onRetry={() => {
            void profile.refetch();
            void trips.refetch();
          }}
          title="Không thể tải chuyến liên kho"
        />
      </AccountLayout>
    );
  }
  if (!profile.data) {
    return (
      <AccountLayout>
        <EmptyState
          description="Tài khoản cần một warehouse assignment active để xem chuyến liên kho."
          title="Chưa có phạm vi kho"
        />
      </AccountLayout>
    );
  }

  const warehouseId = profile.data.warehouseId;
  const columns: DataTableColumn<LineHaulTrip>[] = [
    {
      id: 'trip',
      header: 'Chuyến',
      render: (trip) => (
        <div>
          <Link
            className="focus-ring rounded-control font-mono text-sm font-bold text-primary hover:underline"
            to={`/warehouse/line-haul/${trip.id}`}
          >
            {trip.tripCode}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {trip.originWarehouseId === warehouseId ? 'Chuyến xuất kho' : 'Chuyến đến kho'}
          </p>
        </div>
      ),
    },
    {
      id: 'route',
      header: 'Kho đi → kho đến',
      render: (trip) => (
        <div className="text-sm">
          <p className="font-semibold text-ink">
            {trip.originWarehouse.code} → {trip.destinationWarehouse.code}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {trip.originWarehouse.name} → {trip.destinationWarehouse.name}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (trip) => <LineHaulTripStatusBadge status={trip.status} />,
    },
    {
      id: 'manifest',
      header: 'Manifest / sức tải',
      render: (trip) => (
        <div className="min-w-56">
          <CapacityIndicator
            capacityUtilizationPercent={trip.manifest.capacityUtilizationPercent}
            compact
            manifestWeightGrams={trip.manifest.manifestWeightGrams}
            remainingCapacityWeightGrams={trip.manifest.remainingCapacityWeightGrams}
            vehicleCapacityWeightGrams={trip.manifest.vehicleCapacityWeightGrams}
          />
          <p className="mt-2 text-xs font-semibold tabular-nums text-muted-foreground">
            {trip.manifest.totalTransfers} kiện · đã nhận {trip.manifest.receivedTransfers}
          </p>
        </div>
      ),
    },
    {
      id: 'time',
      header: 'Vận hành',
      render: (trip) => (
        <div className="text-xs leading-5 text-muted-foreground">
          <p>Đi: {trip.departedAt ? formatDateTime(trip.departedAt) : 'Chưa xuất phát'}</p>
          <p>Đến: {trip.arrivedAt ? formatDateTime(trip.arrivedAt) : 'Chưa xác nhận'}</p>
        </div>
      ),
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          actions={
            <div className="w-full sm:min-w-64">
              <SelectField
                id="warehouse-line-haul-status"
                label="Lọc trạng thái"
                onChange={(event) => setStatus(event.target.value as LineHaulTripStatus | '')}
                value={status}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="PLANNED">Đã lập kế hoạch</option>
                <option value="READY">Sẵn sàng xuất phát</option>
                <option value="IN_TRANSIT">Đang chạy tuyến</option>
                <option value="ARRIVED">Đã đến kho đích</option>
                <option value="CANCELLED">Đã hủy</option>
              </SelectField>
            </div>
          }
          description="Theo dõi manifest xuất/nhập, xác nhận xe đến và nhận từng kiện tại đúng kho."
          eyebrow={`${profile.data.warehouse.code} · ${profile.data.warehouse.name}`}
          title="Chuyến liên kho"
        />
        <div className="mt-6">
          <DataTable
            caption="Các chuyến liên kho thuộc phạm vi kho hiện tại"
            columns={columns}
            emptyDescription="Kho hiện chưa có chuyến xuất hoặc chuyến đến phù hợp bộ lọc."
            emptyTitle="Không có chuyến liên kho"
            getRowKey={(trip) => trip.id}
            rows={trips.data?.items ?? []}
          />
        </div>
        <LineHaulScheduleBoard />
      </div>
    </AccountLayout>
  );
}
