import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { ShipmentStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { setMyAvailability } from '../operations/operations-api';
import { DashboardOverviewGrid, MetricCard } from './dashboard-components';
import { getDriverDashboard } from './dashboard-api';

const integerFormatter = new Intl.NumberFormat('vi-VN');
const driverStatusLabel = {
  AVAILABLE: 'Sẵn sàng',
  BUSY: 'Đang bận',
  SUSPENDED: 'Tạm khóa',
  OFFLINE: 'Ngoại tuyến',
} as const;

export function DriverDashboardPage() {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: ['driver-dashboard'], queryFn: getDriverDashboard });
  const availability = useMutation({
    mutationFn: setMyAvailability,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-profile'] }),
      ]);
    },
  });
  if (dashboard.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải dashboard tài xế" />
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <main className="mx-auto max-w-4xl">
        <PageHeader
          description="Tình trạng nhận việc, nhiệm vụ gần đây và kết quả giao hàng trong đúng phạm vi tài xế."
          eyebrow="Driver mobile workspace"
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
          <div className="mt-6 space-y-8">
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Trạng thái nhận việc
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-ink">
                    {driverStatusLabel[dashboard.data.driver.status]}
                  </h2>
                  <p className="mt-2 wrap-anywhere text-base leading-6 text-muted-foreground">
                    {dashboard.data.driver.vehicleType} · {dashboard.data.driver.vehiclePlate} ·{' '}
                    {dashboard.data.driver.employeeCode}
                  </p>
                </div>
                <Button
                  className="touch-manipulation w-full sm:w-auto"
                  disabled={
                    dashboard.data.driver.status === 'BUSY' ||
                    dashboard.data.driver.status === 'SUSPENDED'
                  }
                  loading={availability.isPending}
                  onClick={() => availability.mutate(!dashboard.data.driver.isOnline)}
                  size="lg"
                  variant={dashboard.data.driver.isOnline ? 'secondary' : 'primary'}
                >
                  {dashboard.data.driver.isOnline ? 'Chuyển offline' : 'Bắt đầu nhận việc'}
                </Button>
              </div>
              {availability.isError ? (
                <div className="mt-4">
                  <ErrorSummary message={getApiErrorMessage(availability.error)} />
                </div>
              ) : null}
            </section>

            <section aria-labelledby="driver-task-metrics-heading">
              <h2 className="text-lg font-semibold text-ink" id="driver-task-metrics-heading">
                Nhiệm vụ
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MetricCard label="Chờ phản hồi" tone="warning" value={integerFormatter.format(dashboard.data.assignments.pending)} />
                <MetricCard label="Đang thực hiện" value={integerFormatter.format(dashboard.data.assignments.active)} />
                <MetricCard label="Đã hoàn tất" tone="success" value={integerFormatter.format(dashboard.data.assignments.completed)} />
              </div>
            </section>

            <DashboardOverviewGrid overview={dashboard.data.overview} />

            <section className="rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5">
              <h2 className="text-lg font-semibold text-ink">Nhiệm vụ gần đây</h2>
              {dashboard.data.recentTasks.length ? (
                <ul className="mt-4 space-y-3">
                  {dashboard.data.recentTasks.map((task) => (
                    <li key={task.assignmentId}>
                      <Link
                        className="focus-ring ui-transition block min-h-12 rounded-control border border-border p-4 transition-colors hover:border-primary hover:bg-primary-soft"
                        to={
                          task.type === 'PICKUP'
                            ? `/driver/pickups/${task.assignmentId}`
                            : `/driver/deliveries/${task.assignmentId}`
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-primary">
                            {task.trackingCode}
                          </span>
                          <ShipmentStatusBadge status={task.shipmentStatus} />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {task.type === 'PICKUP' ? 'Lấy hàng' : 'Giao hàng'} ·{' '}
                          {dateTimeFormatter.format(new Date(task.assignedAt))}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-base text-muted-foreground">Chưa có nhiệm vụ.</p>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </AccountLayout>
  );
}
