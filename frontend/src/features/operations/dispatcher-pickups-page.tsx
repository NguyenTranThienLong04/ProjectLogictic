import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { SelectField } from '../../components/ui/select-field';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import type { ShipmentStatus } from '../shipments/shipment-types';
import {
  assignPickup,
  confirmShipment,
  listOperationalShipments,
  reassignPickup,
} from './operations-api';
import { AssignmentCandidateSelect } from './assignment-candidate-select';

type OperationAction =
  | { type: 'confirm'; shipmentId: string }
  | { type: 'assign'; shipmentId: string; driverId: string }
  | { type: 'reassign'; shipmentId: string; driverId: string; reason: string };

const statuses: Array<{ value: ShipmentStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái pickup' },
  { value: 'PENDING', label: 'Chờ xác nhận' },
  { value: 'AWAITING_PICKUP_ASSIGNMENT', label: 'Chờ phân công' },
  { value: 'PICKUP_ASSIGNED', label: 'Đã phân công' },
  { value: 'PICKUP_IN_PROGRESS', label: 'Đang lấy hàng' },
  { value: 'PICKED_UP', label: 'Đã lấy hàng' },
];

export function DispatcherPickupsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedDrivers, setSelectedDrivers] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const shipments = useQuery({
    queryKey: ['operational-shipments', 'PICKUP', status, search, page],
    queryFn: () =>
      listOperationalShipments({
        view: 'PICKUP',
        status: status || undefined,
        search: search.trim() || undefined,
        page,
      }),
  });
  const operation = useMutation({
    mutationFn: async (action: OperationAction) => {
      if (action.type === 'confirm') return confirmShipment(action.shipmentId);
      if (action.type === 'assign') return assignPickup(action);
      return reassignPickup(action);
    },
    onSuccess: async (_, action) => {
      setSuccess(
        action.type === 'confirm'
          ? 'Đã xác nhận và đưa vận đơn vào hàng chờ phân công.'
          : action.type === 'assign'
            ? 'Đã phân công tài xế lấy hàng.'
            : 'Đã lưu lịch sử cũ và phân công tài xế thay thế.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operational-shipments'] }),
        queryClient.invalidateQueries({ queryKey: ['assignment-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });

  if (shipments.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải hàng chờ lấy hàng" />
      </AccountLayout>
    );
  }

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          actions={
            <div className="min-w-48 rounded-surface border border-border bg-surface-subtle px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Phương pháp xếp hạng
              </p>
              <p className="mt-1 text-base font-bold text-primary">Ưu tiên tuyến đường bộ</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Fallback ước tính · ETA chỉ khi có
              </p>
            </div>
          }
          description="Xác nhận vận đơn, chọn tài xế đang sẵn sàng và xử lý các nhiệm vụ cần phân công lại."
          eyebrow="Dispatcher workspace"
          meta={
            <span className="rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {shipments.data?.total ?? 0} vận đơn trong kết quả
            </span>
          }
          title="Điều phối lấy hàng"
        />

        <div className="mt-6">
          <SearchFilter
            label="Tìm vận đơn hoặc khách hàng"
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            onClear={() => {
              setSearch('');
              setPage(1);
            }}
            placeholder="SHP-… hoặc tên khách hàng"
            value={search}
          >
            <div className="w-full md:w-72">
              <SelectField
                id="pickup-status"
                label="Trạng thái pickup"
                onChange={(event) => {
                  setStatus(event.target.value as ShipmentStatus | '');
                  setPage(1);
                }}
                value={status}
              >
                {statuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </SearchFilter>
        </div>

        {success ? (
          <p
            aria-live="polite"
            className="mt-5 rounded-control border border-success/30 bg-success-soft p-4 text-sm font-semibold text-success"
            role="status"
          >
            {success}
          </p>
        ) : null}
        {operation.isError ? (
          <div className="mt-5">
            <ErrorSummary message={getApiErrorMessage(operation.error)} />
          </div>
        ) : null}

        {shipments.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(shipments.error)}
              onRetry={() => void shipments.refetch()}
              title="Không thể tải danh sách vận đơn pickup"
            />
          </div>
        ) : shipments.data?.items.length ? (
          <ul className="mt-6 space-y-3">
            {shipments.data.items.map((shipment) => {
              const driverId = selectedDrivers[shipment.id] ?? '';
              const reason = reasons[shipment.id] ?? '';
              const isCurrent =
                operation.isPending && operation.variables.shipmentId === shipment.id;
              const needsAssignment = shipment.status === 'AWAITING_PICKUP_ASSIGNMENT';
              const canReassign =
                shipment.status === 'PICKUP_ASSIGNED' || shipment.status === 'PICKUP_IN_PROGRESS';
              return (
                <li
                  className="rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5"
                  key={shipment.id}
                >
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="overflow-wrap-anywhere font-extrabold tabular-nums text-ink">
                          {shipment.trackingCode}
                        </p>
                        <ShipmentStatusBadge status={shipment.status} />
                      </div>
                      <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        <Info label="Người gửi" value={shipment.customer.fullName} />
                        <Info label="Người nhận" value={shipment.receiver.fullName} />
                        <Info
                          label="Tạo lúc"
                          value={dateTimeFormatter.format(new Date(shipment.createdAt))}
                        />
                        <Info
                          label="Điểm lấy"
                          value={`${shipment.pickup.streetAddress}, ${shipment.pickup.district}, ${shipment.pickup.city}`}
                        />
                        <Info
                          label="Tài xế hiện tại"
                          value={shipment.assignment?.driverName ?? 'Chưa phân công'}
                        />
                        <Info
                          label="Trạng thái nhiệm vụ"
                          value={shipment.assignment?.status ?? '—'}
                        />
                      </dl>
                    </div>

                    <div className="rounded-surface border border-border bg-surface-subtle p-4">
                      {shipment.status === 'PENDING' ? (
                        <>
                          <p className="text-sm font-semibold text-muted-foreground">
                            Bước tiếp theo
                          </p>
                          <p className="mt-1 font-bold text-ink">Xác nhận thông tin vận đơn</p>
                          <Button
                            className="mt-4 w-full"
                            disabled={operation.isPending}
                            loading={isCurrent}
                            onClick={() =>
                              operation.mutate({ type: 'confirm', shipmentId: shipment.id })
                            }
                          >
                            Xác nhận vận đơn
                          </Button>
                        </>
                      ) : needsAssignment || canReassign ? (
                        <div className="space-y-4">
                          <AssignmentCandidateSelect
                            disabled={operation.isPending}
                            kind="PICKUP"
                            label={canReassign ? 'Tài xế thay thế' : 'Tài xế lấy hàng'}
                            onChange={(value) =>
                              setSelectedDrivers((current) => ({
                                ...current,
                                [shipment.id]: value,
                              }))
                            }
                            selectedDriverId={driverId}
                            shipmentId={shipment.id}
                          />
                          {canReassign ? (
                            <div>
                              <label
                                className="mb-2 block text-sm font-bold text-ink"
                                htmlFor={`reason-${shipment.id}`}
                              >
                                Lý do phân công lại
                              </label>
                              <textarea
                                className="focus-ring ui-transition min-h-24 w-full resize-y rounded-control border border-border bg-surface p-3.5 text-base text-ink shadow-surface outline-none transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted"
                                disabled={operation.isPending}
                                id={`reason-${shipment.id}`}
                                maxLength={500}
                                onChange={(event) =>
                                  setReasons((current) => ({
                                    ...current,
                                    [shipment.id]: event.target.value,
                                  }))
                                }
                                value={reason}
                              />
                            </div>
                          ) : null}
                          <Button
                            className="w-full"
                            disabled={
                              operation.isPending ||
                              !driverId ||
                              (canReassign && reason.trim().length < 3)
                            }
                            loading={isCurrent}
                            onClick={() =>
                              operation.mutate(
                                canReassign
                                  ? {
                                      type: 'reassign',
                                      shipmentId: shipment.id,
                                      driverId,
                                      reason: reason.trim(),
                                    }
                                  : { type: 'assign', shipmentId: shipment.id, driverId },
                              )
                            }
                          >
                            {canReassign ? 'Phân công lại' : 'Phân công tài xế'}
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <p className="font-bold text-ink">Luồng pickup đang được xử lý</p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Trạng thái sẽ tự cập nhật khi tài xế thao tác hoặc có thông báo
                            realtime.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-6">
            <EmptyState
              description="Thử bỏ bộ lọc hoặc đổi từ khóa tìm kiếm."
              title="Không có vận đơn phù hợp"
            />
          </div>
        )}
        {shipments.data ? (
          <div className="mt-5">
            <Pagination
              disabled={shipments.isFetching}
              onPageChange={setPage}
              page={shipments.data.page}
              totalPages={shipments.data.totalPages}
            />
          </div>
        ) : null}
      </div>
    </AccountLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 wrap-anywhere font-semibold leading-5 text-ink">{value}</dd>
    </div>
  );
}
