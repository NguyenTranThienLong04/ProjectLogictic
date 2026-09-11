import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { getMyDriverLocation } from './location-api';
import { LocationMap } from './location-map';

export function DriverMapPage() {
  const location = useQuery({
    queryKey: ['driver-current-location'],
    queryFn: getMyDriverLocation,
    refetchInterval: 5_000,
  });
  if (location.isPending) return <AccountLayout><LoadingState label="Đang tải vị trí hiện tại" /></AccountLayout>;
  return (
    <AccountLayout>
      <main className="mx-auto max-w-4xl">
        <PageHeader
          description="Vị trí GPS của chính bạn từ Redis; tự hết hạn sau 20 giây nếu thiết bị ngừng gửi."
          eyebrow="Driver mobile workspace"
          title="Bản đồ"
        />
        {location.isError ? (
          <div className="mt-6"><ErrorState message={getApiErrorMessage(location.error)} onRetry={() => void location.refetch()} title="Không thể tải vị trí" /></div>
        ) : location.data ? (
          <section className="mt-6 rounded-surface border border-border bg-surface p-3 shadow-surface sm:p-4">
            <LocationMap markers={[{ id: location.data.driverId, latitude: location.data.latitude, longitude: location.data.longitude, label: 'Vị trí hiện tại của bạn' }]} />
            <p className="mt-3 text-sm text-muted-foreground">Cập nhật gần nhất: {dateTimeFormatter.format(new Date(location.data.updatedAt))}</p>
          </section>
        ) : (
          <div className="mt-6"><EmptyState description="Cho phép quyền vị trí và giữ trạng thái nhận việc online. Vị trí stale sẽ tự biến mất theo TTL." title="Chưa có vị trí GPS hiện tại" /></div>
        )}
      </main>
    </AccountLayout>
  );
}
