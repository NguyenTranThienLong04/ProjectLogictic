import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SelectField } from '../../components/ui/select-field';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listShipments } from './shipment-api';
import type { ShipmentStatus } from './shipment-types';

export function ShipmentsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const shipmentsQuery = useQuery({
    queryKey: ['shipments', page, status],
    queryFn: () => listShipments({ page, status: status || undefined }),
  });

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          actions={(
            <Link
              className="focus-ring ui-transition inline-flex min-h-12 w-full items-center justify-center rounded-control border border-primary bg-primary px-5 text-sm font-semibold text-on-primary shadow-surface hover:border-primary-strong hover:bg-primary-strong sm:w-auto"
              to="/shipments/new"
            >
              Tạo vận đơn
            </Link>
          )}
          description="Theo dõi trạng thái và xem lại chi phí của từng kiện hàng."
          eyebrow="Khách hàng"
          title="Vận đơn của tôi"
        />

        <div className="mt-6 rounded-surface border border-border bg-surface p-4 shadow-surface sm:max-w-sm">
          <SelectField
            disabled={shipmentsQuery.isFetching}
            id="shipment-status-filter"
            label="Lọc theo trạng thái"
            onChange={(event) => {
              setStatus(event.target.value as ShipmentStatus | '');
              setPage(1);
            }}
            value={status}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="PENDING">Chờ xác nhận</option>
            <option value="CONFIRMED">Đã xác nhận</option>
            <option value="AWAITING_PICKUP_ASSIGNMENT">Chờ phân công lấy hàng</option>
            <option value="CANCELLED">Đã hủy</option>
          </SelectField>
        </div>

        {shipmentsQuery.isPending ? (
          <LoadingState label="Đang tải vận đơn" />
        ) : shipmentsQuery.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(shipmentsQuery.error)}
              onRetry={() => shipmentsQuery.refetch()}
              title="Không thể tải danh sách vận đơn"
            />
          </div>
        ) : shipmentsQuery.data.items.length ? (
          <>
            <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shipmentsQuery.data.items.map((shipment) => (
                <li key={shipment.id}>
                  <Link className="focus-ring ui-transition block h-full rounded-surface border border-border bg-surface p-5 shadow-surface transition-colors hover:border-primary hover:shadow-raised sm:p-6" to={`/shipments/${shipment.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="break-all font-semibold text-primary">{shipment.trackingCode}</span>
                      <ShipmentStatusBadge status={shipment.status} />
                    </div>
                    <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                      <div><dt className="text-muted-foreground">Người nhận</dt><dd className="mt-1 font-semibold text-ink">{shipment.receiverName}</dd></div>
                      <div><dt className="text-muted-foreground">Điểm đến</dt><dd className="mt-1 font-semibold text-ink">{shipment.deliveryCity}</dd></div>
                      <div><dt className="text-muted-foreground">Phí vận chuyển</dt><dd className="mt-1 font-semibold tabular-nums text-ink">{vndFormatter.format(shipment.totalFee)}</dd></div>
                      <div><dt className="text-muted-foreground">Ngày tạo</dt><dd className="mt-1 font-semibold text-ink">{dateTimeFormatter.format(new Date(shipment.createdAt))}</dd></div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-surface border border-border bg-surface p-4 shadow-surface">
              <Pagination
                disabled={shipmentsQuery.isFetching}
                label="Phân trang vận đơn"
                onPageChange={setPage}
                page={shipmentsQuery.data.page}
                totalPages={Math.max(1, shipmentsQuery.data.totalPages)}
              />
            </div>
          </>
        ) : (
          <div className="mt-6">
            <EmptyState
              action={(
                <Link
                  className="focus-ring ui-transition inline-flex min-h-12 items-center justify-center rounded-control border border-primary bg-primary px-5 text-sm font-semibold text-on-primary shadow-surface hover:border-primary-strong hover:bg-primary-strong"
                  to="/shipments/new"
                >
                  Tạo vận đơn đầu tiên
                </Link>
              )}
              description="Tạo vận đơn mới hoặc thay đổi bộ lọc trạng thái."
              title="Chưa có vận đơn phù hợp"
            />
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
