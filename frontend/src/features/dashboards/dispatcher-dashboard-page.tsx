import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { DashboardOverviewGrid, MetricCard, RecentShipmentsTable } from './dashboard-components';
import { getDispatcherDashboard } from './dashboard-api';

const integerFormatter = new Intl.NumberFormat('vi-VN');

export function DispatcherDashboardPage() {
  const dashboard = useQuery({
    queryKey: ['dispatcher-dashboard'],
    queryFn: getDispatcherDashboard,
  });
  if (dashboard.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải dashboard điều phối" />
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader
          description="Khối lượng công việc và các hàng chờ cần điều phối, tính trực tiếp bằng PostgreSQL."
          eyebrow="Dispatcher workspace"
          title="Dashboard điều phối"
        />
        {dashboard.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(dashboard.error)}
              onRetry={() => void dashboard.refetch()}
              title="Không thể tải dashboard"
            />
          </div>
        ) : dashboard.data ? (
          <div className="mt-6">
            <DashboardOverviewGrid overview={dashboard.data.overview} />
            <section className="mt-8" aria-labelledby="dispatcher-queues-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink" id="dispatcher-queues-heading">
                    Hàng chờ điều phối
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chọn một chỉ số để mở đúng màn xử lý.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link className="focus-ring rounded-surface" to="/dispatcher/pickups">
                  <MetricCard label="Chờ phân công lấy" value={integerFormatter.format(dashboard.data.operations.awaitingPickupAssignment)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/deliveries">
                  <MetricCard label="Chờ phân công giao" value={integerFormatter.format(dashboard.data.operations.awaitingDeliveryAssignment)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/drivers">
                  <MetricCard label="Tài xế sẵn sàng" tone="success" value={integerFormatter.format(dashboard.data.operations.availableDrivers)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/failed-deliveries">
                  <MetricCard label="Giao thất bại" tone="danger" value={integerFormatter.format(dashboard.data.overview.failed)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/returns">
                  <MetricCard label="Yêu cầu hoàn" tone="warning" value={integerFormatter.format(dashboard.data.operations.returnRequested)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/returns">
                  <MetricCard label="Đang hoàn" tone="warning" value={integerFormatter.format(dashboard.data.operations.returnInTransit)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/dispatcher/exceptions">
                  <MetricCard label="Hư hỏng / thất lạc" tone="danger" value={integerFormatter.format(dashboard.data.operations.damagedOrLost)} />
                </Link>
                <MetricCard label="COD tranh chấp" tone="danger" value={integerFormatter.format(dashboard.data.operations.disputedCod)} />
              </div>
            </section>
            <RecentShipmentsTable
              linkForRow={(row) =>
                `/dispatcher/shipments?search=${encodeURIComponent(row.trackingCode)}`
              }
              rows={dashboard.data.recentShipments}
            />
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
