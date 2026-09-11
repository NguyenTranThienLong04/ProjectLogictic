import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { getAnalytics, type AnalyticsFilters } from '../analytics/analytics-api';
import { DashboardOverviewGrid, MetricCard } from './dashboard-components';

const integerFormatter = new Intl.NumberFormat('vi-VN');

function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dashboardFilters(): AnalyticsFilters {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return {
    from: dateInputValue(from),
    to: dateInputValue(to),
    warehouseId: '',
    driverId: '',
    granularity: 'day',
  };
}

export function AdminDashboardPage() {
  const analytics = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => getAnalytics(dashboardFilters()),
  });
  if (analytics.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải dashboard quản trị" />
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader
          description="Tổng quan 30 ngày gần nhất và lối tắt đến các khu vực quản trị trọng yếu."
          eyebrow="Admin workspace"
          title="Dashboard quản trị"
        />
        {analytics.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(analytics.error)}
              onRetry={() => void analytics.refetch()}
              title="Không thể tải dashboard"
            />
          </div>
        ) : analytics.data ? (
          <div className="mt-6 space-y-8">
            <DashboardOverviewGrid
              overview={{
                ...analytics.data.overview,
                codCollected: analytics.data.codStats.collectedAmount,
                codUnsettled: analytics.data.codStats.unsettledAmount,
              }}
            />
            <section aria-labelledby="admin-shortcuts-heading">
              <h2 className="text-lg font-semibold text-ink" id="admin-shortcuts-heading">
                Khu vực quản trị
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link className="focus-ring rounded-surface" to="/admin/users">
                  <MetricCard label="Quản lý người dùng" value="Mở danh sách" />
                </Link>
                <Link className="focus-ring rounded-surface" to="/admin/shipments">
                  <MetricCard label="Toàn bộ vận đơn" value={integerFormatter.format(analytics.data.overview.totalShipments)} />
                </Link>
                <Link className="focus-ring rounded-surface" to="/admin/audit-logs">
                  <MetricCard label="Nhật ký kiểm toán" tone="slate" value="Tra cứu" />
                </Link>
                <Link className="focus-ring rounded-surface" to="/admin/analytics">
                  <MetricCard label="Analytics chi tiết" value="Mở báo cáo" />
                </Link>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
