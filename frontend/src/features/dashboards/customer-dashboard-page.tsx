import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { DashboardOverviewGrid, RecentShipmentsTable } from './dashboard-components';
import { getCustomerDashboard } from './dashboard-api';

export function CustomerDashboardPage() {
  const dashboard = useQuery({ queryKey: ['customer-dashboard'], queryFn: getCustomerDashboard, refetchInterval: 30_000 });
  if (dashboard.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải dashboard khách hàng" />
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader
          actions={
            <Link to="/shipments/new">
              <Button size="lg">Tạo vận đơn</Button>
            </Link>
          }
          description="Theo dõi tiến độ, hiệu suất giao và COD của toàn bộ vận đơn thuộc tài khoản."
          eyebrow="Customer workspace"
          title="Dashboard"
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
            <p className="mt-3 text-sm text-muted-foreground">COD chờ chi trả là khoản đã đối soát nhưng bạn chưa xác nhận nhận tiền, gồm cả khoản đang có vấn đề. COD đã chi trả chỉ tăng sau khi bạn xác nhận.</p>
            <RecentShipmentsTable rows={dashboard.data.recentShipments} />
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
