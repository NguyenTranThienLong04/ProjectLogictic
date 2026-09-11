import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import {
  assignDelivery,
  listOperationalShipments,
  redeliver,
  requestReturn,
} from './operations-api';
import { AssignmentCandidateSelect } from './assignment-candidate-select';

export function DispatcherDeliveriesPage() {
  const client = useQueryClient();
  const [driver, setDriver] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const shipments = useQuery({
    queryKey: ['delivery-operations', page],
    queryFn: () => listOperationalShipments({ view: 'DELIVERY', page }),
  });
  const action = useMutation({
    mutationFn: async (input: { kind: 'assign' | 'redeliver' | 'return'; id: string }) =>
      input.kind === 'assign'
        ? assignDelivery({ shipmentId: input.id, driverId: driver[input.id] })
        : input.kind === 'redeliver'
          ? redeliver(input.id)
          : requestReturn(input.id, note[input.id]),
    onSuccess: async (_, input) => {
      setSuccess(
        input.kind === 'assign'
          ? 'Đã phân công tài xế giao hàng.'
          : input.kind === 'redeliver'
            ? 'Đã đưa vận đơn vào hàng chờ phân công giao lại.'
            : 'Đã khởi tạo yêu cầu hoàn hàng.',
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['delivery-operations'] }),
        client.invalidateQueries({ queryKey: ['assignment-candidates'] }),
      ]);
    },
  });
  if (shipments.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải điều phối giao hàng" />
      </AccountLayout>
    );
  }
  const items = shipments.data?.items ?? [];
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
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
          description="Phân công giao cuối chặng, xử lý giao lại hoặc khởi tạo luồng hoàn hàng sau lần giao thất bại."
          eyebrow="Dispatcher workspace"
          meta={
            <span className="rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {items.length} vận đơn cần theo dõi
            </span>
          }
          title="Điều phối giao hàng"
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-5 rounded-control border border-success/30 bg-success-soft p-4 text-sm font-semibold text-success"
            role="status"
          >
            {success}
          </p>
        ) : null}

        {action.isError ? (
          <div className="mt-5">
            <ErrorSummary message={getApiErrorMessage(action.error)} />
          </div>
        ) : null}

        {shipments.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(shipments.error)}
              onRetry={() => void shipments.refetch()}
              title="Không thể tải điều phối giao hàng"
            />
          </div>
        ) : items.length ? (
          <ul className="mt-6 space-y-3">
            {items.map((shipment) => {
              const isCurrent = action.isPending && action.variables.id === shipment.id;
              return (
                <li
                  className="rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5"
                  key={shipment.id}
                >
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <strong className="wrap-anywhere font-mono font-semibold text-primary">
                          {shipment.trackingCode}
                        </strong>
                        <ShipmentStatusBadge status={shipment.status} />
                      </div>
                      <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                            Người nhận
                          </dt>
                          <dd className="mt-1 font-semibold text-ink">
                            {shipment.receiver.fullName}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                            Tài xế hiện tại
                          </dt>
                          <dd className="mt-1 font-semibold text-ink">
                            {shipment.deliveryAssignment?.driverName ?? 'Chưa phân công'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                            Tạo lúc
                          </dt>
                          <dd className="mt-1 font-semibold text-ink">
                            {dateTimeFormatter.format(new Date(shipment.createdAt))}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="rounded-surface border border-border bg-surface-subtle p-4">
                      {shipment.status === 'AWAITING_DELIVERY_ASSIGNMENT' ? (
                        <div className="space-y-4">
                          <AssignmentCandidateSelect
                            disabled={action.isPending}
                            kind="DELIVERY"
                            label="Tài xế giao hàng"
                            onChange={(value) =>
                              setDriver((current) => ({
                                ...current,
                                [shipment.id]: value,
                              }))
                            }
                            selectedDriverId={driver[shipment.id] ?? ''}
                            shipmentId={shipment.id}
                          />
                          <Button
                            className="w-full"
                            disabled={action.isPending || !driver[shipment.id]}
                            loading={isCurrent && action.variables.kind === 'assign'}
                            onClick={() => action.mutate({ kind: 'assign', id: shipment.id })}
                          >
                            Phân công giao
                          </Button>
                        </div>
                      ) : shipment.status === 'DELIVERY_FAILED' ? (
                        <div className="space-y-4">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              Quyết định bước tiếp theo
                            </p>
                            <p className="mt-1 text-sm leading-5 text-muted-foreground">
                              Chọn giao lại hoặc khởi tạo quy trình hoàn hàng.
                            </p>
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-sm font-semibold text-ink"
                              htmlFor={`return-note-${shipment.id}`}
                            >
                              Ghi chú hoàn hàng (tùy chọn)
                            </label>
                            <textarea
                              className="focus-ring ui-transition min-h-24 w-full resize-y rounded-control border border-border bg-surface p-3.5 text-base text-ink shadow-surface outline-none transition-colors placeholder:text-slate-400 hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted"
                              disabled={action.isPending}
                              id={`return-note-${shipment.id}`}
                              maxLength={500}
                              onChange={(event) =>
                                setNote((current) => ({
                                  ...current,
                                  [shipment.id]: event.target.value,
                                }))
                              }
                              placeholder="Thông tin cần lưu cho quy trình hoàn"
                              value={note[shipment.id] ?? ''}
                            />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                              className="w-full"
                              disabled={action.isPending}
                              loading={isCurrent && action.variables.kind === 'redeliver'}
                              onClick={() => action.mutate({ kind: 'redeliver', id: shipment.id })}
                            >
                              Lên lịch giao lại
                            </Button>
                            <Button
                              className="w-full"
                              disabled={action.isPending}
                              loading={isCurrent && action.variables.kind === 'return'}
                              onClick={() => action.mutate({ kind: 'return', id: shipment.id })}
                              variant="danger"
                            >
                              Yêu cầu hoàn hàng
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="font-semibold text-ink">Tài xế đang xử lý nhiệm vụ</p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Dữ liệu sẽ được làm mới sau command hợp lệ.
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
            <EmptyState title="Không có vận đơn cần điều phối giao" />
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
      </main>
    </AccountLayout>
  );
}
