import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { DeliveryFailureReasonBadge, ShipmentStatusBadge } from '../../components/ui/status-badge';
import { shipmentStatusBadgeConfig } from '../../components/ui/status-badge-config';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listOperationalShipments, redeliver, requestReturn } from './operations-api';
import type { OperationalShipment, OperationalShipmentView } from './operations-types';
import type { ShipmentStatus } from '../shipments/shipment-types';

type FailedDecision = { shipment: OperationalShipment; kind: 'redeliver' | 'return' };

const viewStatuses: Record<OperationalShipmentView, ShipmentStatus[]> = {
  PICKUP: ['PENDING', 'CONFIRMED', 'AWAITING_PICKUP_ASSIGNMENT', 'PICKUP_ASSIGNED', 'PICKUP_IN_PROGRESS', 'PICKED_UP'],
  DELIVERY: ['AWAITING_DELIVERY_ASSIGNMENT', 'DELIVERY_ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  FAILED: ['DELIVERY_FAILED'],
  RETURNS: ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED'],
  EXCEPTIONS: ['DAMAGED', 'LOST'],
  ALL: Object.keys(shipmentStatusBadgeConfig) as ShipmentStatus[],
};

interface PageConfig {
  title: string;
  description: string;
  eyebrow: string;
  view: OperationalShipmentView;
  detailBasePath?: string;
  allowFailedActions?: boolean;
}

function OperationalShipmentsPage({ allowFailedActions = false, description, detailBasePath = '/dispatcher/shipments', eyebrow, title, view }: PageConfig) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<FailedDecision | null>(null);
  const [success, setSuccess] = useState('');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const status = (params.get('status') || '') as ShipmentStatus | '';
  const fromDate = params.get('from') ?? '';
  const toDate = params.get('to') ?? '';
  const shipments = useQuery({
    queryKey: ['operational-shipments', view, { page, search, status, fromDate, toDate }],
    queryFn: () => listOperationalShipments({ view, page, search: search || undefined, status: status || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });
  const command = useMutation({
    mutationFn: (input: FailedDecision) => input.kind === 'redeliver' ? redeliver(input.shipment.id) : requestReturn(input.shipment.id),
    onSuccess: async (_, input) => {
      setSuccess(input.kind === 'redeliver' ? 'Đã đưa vận đơn vào hàng chờ giao lại.' : 'Đã khởi tạo yêu cầu hoàn hàng.');
      setDecision(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operational-shipments'] }),
        queryClient.invalidateQueries({ queryKey: ['dispatcher-dashboard'] }),
      ]);
    },
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  };
  const columns: DataTableColumn<OperationalShipment>[] = [
    { id: 'trackingCode', header: 'Mã vận đơn', render: (row) => <Link className="focus-ring rounded-sm font-mono font-semibold text-primary hover:text-primary-strong hover:underline" to={`${detailBasePath}/${row.id}`}>{row.trackingCode}</Link> },
    { id: 'status', header: 'Trạng thái', render: (row) => <ShipmentStatusBadge status={row.status} /> },
    { id: 'customer', header: 'Khách hàng', render: (row) => row.customer.fullName },
    { id: 'receiver', header: 'Người nhận', render: (row) => `${row.receiver.fullName} · ${row.delivery.city}` },
    { id: 'driver', header: 'Tài xế', render: (row) => row.deliveryAssignment?.driverName ?? row.pickupAssignment?.driverName ?? 'Chưa phân công' },
    { id: 'warehouse', header: 'Vị trí kho', render: (row) => row.currentWarehouse ? `${row.currentWarehouse.code} · ${row.currentWarehouse.name}` : 'Không ở kho' },
    { id: 'failure', header: 'Nguyên nhân', render: (row) => row.latestDeliveryAttempt?.failureReason ? <DeliveryFailureReasonBadge reason={row.latestDeliveryAttempt.failureReason} /> : '—' },
    { id: 'cod', header: 'COD', align: 'right', render: (row) => <span className="tabular-nums">{vndFormatter.format(row.codAmount)}</span> },
    { id: 'createdAt', header: 'Tạo lúc', render: (row) => dateTimeFormatter.format(new Date(row.createdAt)) },
    ...(allowFailedActions ? [{ id: 'actions', header: 'Xử lý', render: (row: OperationalShipment) => row.status === 'DELIVERY_FAILED' ? <div className="flex flex-wrap gap-2"><Button disabled={command.isPending} onClick={() => setDecision({ shipment: row, kind: 'redeliver' })}>Giao lại</Button><Button disabled={command.isPending} onClick={() => setDecision({ shipment: row, kind: 'return' })} variant="danger">Hoàn hàng</Button></div> : 'Đã xử lý' }] : []),
  ];
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader description={description} eyebrow={eyebrow} title={title} />
        {success ? <p aria-live="polite" className="mt-5 rounded-control border border-success/30 bg-success-soft p-4 font-semibold text-success">{success}</p> : null}
        {command.isError ? <div className="mt-5"><ErrorSummary message={getApiErrorMessage(command.error)} /></div> : null}
        <div className="mt-6">
          <SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Tìm mã vận đơn hoặc khách hàng" value={search}>
            <label className="min-w-52 text-sm font-semibold text-ink">Trạng thái<Select className="mt-1.5" onChange={(event) => update('status', event.target.value)} value={status}><option value="">Tất cả trong màn này</option>{viewStatuses[view].map((value) => <option key={value} value={value}>{shipmentStatusBadgeConfig[value].label}</option>)}</Select></label>
            <label className="text-sm font-semibold text-ink">Từ ngày<Input className="mt-1.5" onChange={(event) => update('from', event.target.value)} type="date" value={fromDate} /></label>
            <label className="text-sm font-semibold text-ink">Đến ngày<Input className="mt-1.5" onChange={(event) => update('to', event.target.value)} type="date" value={toDate} /></label>
          </SearchFilter>
        </div>
        <div className="mt-6"><DataTable caption={title} columns={columns} emptyDescription="Thử đổi bộ lọc hoặc từ khóa tìm kiếm." emptyTitle="Không có vận đơn phù hợp" error={shipments.isError ? getApiErrorMessage(shipments.error) : undefined} getRowKey={(row) => row.id} loading={shipments.isPending} onRetry={() => void shipments.refetch()} rows={shipments.data?.items ?? []} /></div>
        {shipments.data ? <div className="mt-5"><Pagination disabled={shipments.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={shipments.data.page} totalPages={shipments.data.totalPages} /></div> : null}
        <ConfirmDialog
          destructive={decision?.kind === 'return'}
          description={decision ? `${decision.shipment.trackingCode}: ${decision.kind === 'redeliver' ? 'đưa về hàng chờ phân công giao lại' : 'khởi tạo luồng hoàn hàng về kho trả'}.` : ''}
          loading={command.isPending}
          onCancel={() => setDecision(null)}
          onConfirm={() => { if (decision) command.mutate(decision); }}
          open={Boolean(decision)}
          title={decision?.kind === 'redeliver' ? 'Xác nhận giao lại' : 'Xác nhận hoàn hàng'}
        />
      </main>
    </AccountLayout>
  );
}

export function DispatcherShipmentsPage() { return <OperationalShipmentsPage description="Toàn bộ vòng đời vận đơn với tìm kiếm, trạng thái và khoảng ngày phía server." eyebrow="Dispatcher workspace" title="Tất cả vận đơn" view="ALL" />; }
export function AdminShipmentsPage() { return <OperationalShipmentsPage description="Danh sách vận đơn toàn hệ thống; Admin vẫn không bypass lifecycle command." detailBasePath="/admin/shipments" eyebrow="Admin workspace" title="Tất cả vận đơn" view="ALL" />; }
export function DispatcherFailedDeliveriesPage() { return <OperationalShipmentsPage allowFailedActions description="Xem nguyên nhân lần giao mới nhất và chọn command giao lại hoặc hoàn hàng." eyebrow="Dispatcher workspace" title="Giao hàng thất bại" view="FAILED" />; }
export function DispatcherReturnsPage() { return <OperationalShipmentsPage description="Theo dõi RETURN_REQUESTED, RETURN_IN_TRANSIT và RETURNED trên một danh sách riêng." eyebrow="Dispatcher workspace" title="Hoàn hàng" view="RETURNS" />; }
export function DispatcherExceptionsPage() { return <OperationalShipmentsPage description="Theo dõi trạng thái hư hỏng và thất lạc canonical; không tạo transition tùy ý từ UI." eyebrow="Dispatcher workspace" title="Ngoại lệ vận hành" view="EXCEPTIONS" />; }
