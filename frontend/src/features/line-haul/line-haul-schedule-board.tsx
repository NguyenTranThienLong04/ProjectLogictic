import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { FormField } from '../../components/ui/form-field';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { useAuth } from '../auth/auth-context';
import { listLineHaulTrips } from './line-haul-api';
import { scheduleDayRange, toLocalDateInputValue } from './line-haul-schedule';
import type { LineHaulTrip } from './line-haul-types';

export function LineHaulScheduleBoard() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => toLocalDateInputValue(new Date()));
  const range = scheduleDayRange(date);
  const detailBase =
    user?.role === 'ADMIN'
      ? '/admin/line-haul/trips'
      : user?.role === 'WAREHOUSE_STAFF'
        ? '/warehouse/line-haul'
        : '/dispatcher/line-haul';
  const board = useQuery({
    queryKey: ['line-haul-schedule-board', date, user?.role],
    queryFn: () =>
      listLineHaulTrips({
        scheduledFrom: range!.scheduledFrom,
        scheduledTo: range!.scheduledTo,
        page: 1,
        limit: 100,
      }),
    enabled: range !== null,
  });
  const columns: DataTableColumn<LineHaulTrip>[] = [
    {
      id: 'date',
      header: 'Ngày',
      render: (trip) => (
        <span className="tabular-nums">
          {trip.scheduledStartAt
            ? new Date(trip.scheduledStartAt).toLocaleDateString('vi-VN')
            : '—'}
        </span>
      ),
    },
    {
      id: 'trip',
      header: 'Chuyến',
      render: (trip) => (
        <Link
          className="focus-ring rounded-control font-mono text-xs font-bold text-primary hover:underline"
          to={`${detailBase}/${trip.id}`}
        >
          {trip.tripCode}
        </Link>
      ),
    },
    {
      id: 'route',
      header: 'Tuyến',
      render: (trip) => (
        <span className="font-semibold text-ink">
          {trip.originWarehouse.code} → {trip.destinationWarehouse.code}
        </span>
      ),
    },
    {
      id: 'driver',
      header: 'Tài xế',
      render: (trip) => (
        <span className="block">
          <span className="block font-medium text-ink">{trip.driver.fullName}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {trip.driver.employeeCode}
          </span>
        </span>
      ),
    },
    {
      id: 'vehicle',
      header: 'Xe',
      render: (trip) => (
        <span className="block">
          <span className="block font-medium text-ink">{trip.vehicle.vehicleCode}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {trip.vehicle.licensePlate}
          </span>
        </span>
      ),
    },
    {
      id: 'window',
      header: 'Bắt đầu / kết thúc',
      render: (trip) => (
        <span className="block whitespace-nowrap text-xs leading-5 tabular-nums">
          <span className="block font-semibold text-ink">
            {trip.scheduledStartAt
              ? new Date(trip.scheduledStartAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </span>
          <span className="block text-muted-foreground">
            đến{' '}
            {trip.scheduledEndAt
              ? new Date(trip.scheduledEndAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (trip) => <LineHaulTripStatusBadge status={trip.status} />,
    },
  ];

  return (
    <section aria-labelledby="line-haul-schedule-board-title" className="mt-8 min-w-0">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink" id="line-haul-schedule-board-title">
            Bảng lịch chuyến
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {user?.role === 'WAREHOUSE_STAFF'
              ? 'Chỉ hiển thị chuyến xuất phát hoặc đến kho được phân công.'
              : 'Lịch tài xế và xe trên toàn mạng theo ngày đã chọn.'}
          </p>
        </div>
        <FormField
          className="sm:w-52"
          id="line-haul-schedule-date"
          label="Ngày vận hành"
          onChange={(event) => setDate(event.target.value)}
          type="date"
          value={date}
        />
      </div>
      <DataTable
        caption={`Lịch chuyến liên kho ngày ${date}`}
        columns={columns}
        emptyDescription="Chọn ngày khác hoặc lên lịch cho một trip PLANNED."
        emptyTitle="Ngày này chưa có chuyến"
        error={board.isError ? getApiErrorMessage(board.error) : undefined}
        getRowKey={(trip) => trip.id}
        loading={board.isPending}
        loadingLabel="Đang tải bảng lịch chuyến"
        onRetry={() => board.refetch()}
        rows={board.data?.items ?? []}
      />
    </section>
  );
}
