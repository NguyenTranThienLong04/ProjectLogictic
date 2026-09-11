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
  const dashboard = useQuery({ queryKey: ['customer-dashboard'], queryFn: getCustomerDashboard });
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
            <RecentShipmentsTable rows={dashboard.data.recentShipments} />
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
