import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ErrorState } from '../../../components/ui/error-state';
import { LoadingState } from '../../../components/ui/loading-state';
import { PageHeader } from '../../../components/ui/page-header';
import { WarehouseTransferStatusBadge } from '../../../components/ui/status-badge';
import { getApiErrorMessage } from '../../../services/api-error';
import { formatDateTime } from '../../../utils/format';
import { AccountLayout } from '../../auth/components/account-layout';
import { tripPath } from '../../control-tower/control-tower-model';
import type { OperationsRole } from '../../control-tower/control-tower-types';
import { getWarehouseTransfer } from '../warehouses-api';

export function TransferDetailPage({ role }: { role: OperationsRole }) {
  const { warehouseId = '', id = '' } = useParams();
  const transfer = useQuery({
    queryKey: ['warehouse-transfer', warehouseId, id],
    queryFn: () => getWarehouseTransfer(warehouseId, id),
    enabled: Boolean(warehouseId && id),
  });
  const row = transfer.data;
  return (
    <AccountLayout>
      <main className="mx-auto max-w-5xl space-y-6">
        <Link
          className="focus-ring inline-flex min-h-11 items-center rounded-control font-semibold text-primary underline"
          to={`/${role}/control-tower`}
        >
          Control Tower
        </Link>
        {transfer.isPending ? (
          <LoadingState label="Đang tải Transfer" />
        ) : transfer.isError ? (
          <ErrorState
            message={getApiErrorMessage(transfer.error)}
            onRetry={() => transfer.refetch()}
          />
        ) : row ? (
          <>
            <PageHeader
              eyebrow="Chi tiết Transfer"
              title={row.transferCode}
              description={`${row.fromWarehouse?.code} → ${row.toWarehouse?.code}`}
              actions={<WarehouseTransferStatusBadge status={row.status} />}
            />
            <section className="rounded-surface border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold">Lịch sử trung chuyển</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  ['Kho xuất', row.fromWarehouse?.name ?? row.fromWarehouseId],
                  ['Kho nhận', row.toWarehouse?.name ?? row.toWarehouseId],
                  ['Tạo lúc', formatDateTime(row.createdAt)],
                  [
                    'Xuất kho',
                    row.dispatchedAt ? formatDateTime(row.dispatchedAt) : 'Chưa xuất kho',
                  ],
                  [
                    'Nhận tại kho đích',
                    row.receivedAt ? formatDateTime(row.receivedAt) : 'Chưa nhận',
                  ],
                  ['Ghi chú', row.note || '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section
              className="flex flex-wrap gap-4 rounded-surface border border-border bg-surface p-5"
              aria-label="Bản ghi liên quan"
            >
              <Link
                className="focus-ring inline-flex min-h-11 items-center rounded-control font-semibold text-primary underline"
                to={`/${role}/shipments/${row.shipmentId}`}
              >
                {row.shipment?.trackingCode ?? 'Mở Shipment'}
              </Link>
              {row.lineHaulTrip ? (
                <Link
                  className="focus-ring inline-flex min-h-11 items-center rounded-control font-semibold text-primary underline"
                  to={tripPath(role, row.lineHaulTrip.id)}
                >
                  {row.lineHaulTrip.tripCode}
                </Link>
              ) : (
                <p className="text-muted-foreground">Transfer không gắn chuyến.</p>
              )}
            </section>
          </>
        ) : null}
      </main>
    </AccountLayout>
  );
}
