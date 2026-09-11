import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getAccessToken } from '../../services/auth-session';
import { createOperationsSocket } from '../../services/operations-socket';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import { listOperationalDriverLocations } from './location-api';
import { LocationMap } from './location-map';
import type { DriverLocation, OperationalDriverLocation } from './location-types';

export function DispatcherDriverMapPage() {
  const queryClient = useQueryClient();
  const locations = useQuery({
    queryKey: ['operational-driver-locations'],
    queryFn: listOperationalDriverLocations,
    refetchInterval: 20_000,
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket = createOperationsSocket();
    socket.on('connect', () => {
      void queryClient.invalidateQueries({ queryKey: ['operational-driver-locations'] });
    });
    socket.on('driver.location.updated', (payload: DriverLocation) => {
      const current = queryClient.getQueryData<OperationalDriverLocation[]>([
        'operational-driver-locations',
      ]);
      if (!current?.some((item) => item.driverId === payload.driverId)) {
        void queryClient.invalidateQueries({ queryKey: ['operational-driver-locations'] });
        return;
      }
      queryClient.setQueryData<OperationalDriverLocation[]>(
        ['operational-driver-locations'],
        (items = []) => {
          return items.map((item) =>
            item.driverId === payload.driverId ? { ...item, ...payload } : item,
          );
        },
      );
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  if (locations.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải bản đồ tài xế" />
      </AccountLayout>
    );
  }

  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader
          description="Vị trí hiện tại của tài xế online, tự làm mới qua API khi socket reconnect."
          eyebrow="Dispatcher workspace"
          meta={
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              Nguồn dữ liệu GPS realtime
            </span>
          }
          title="Bản đồ tài xế"
        />

        {locations.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(locations.error)}
              onRetry={() => void locations.refetch()}
              title="Không thể tải vị trí tài xế"
            />
          </div>
        ) : locations.data?.length ? (
          <section
            aria-labelledby="dispatcher-map-heading"
            className="mt-6 overflow-hidden rounded-surface border border-border bg-surface shadow-surface"
          >
            <div className="flex flex-col gap-2 border-b border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink" id="dispatcher-map-heading">
                  Phạm vi vận hành hiện tại
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chọn marker để xem tài xế và biển số phương tiện.
                </p>
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Cuộn trang không làm thay đổi zoom bản đồ
              </p>
            </div>
            <div className="dispatcher-driver-map bg-surface p-2 sm:p-3">
              <LocationMap
                markers={locations.data.map((location) => ({
                  id: location.driverId,
                  latitude: location.latitude,
                  longitude: location.longitude,
                  label: `${location.fullName} · ${location.vehiclePlate}`,
                }))}
              />
            </div>
          </section>
        ) : (
          <div className="mt-6">
            <EmptyState
              description="Vị trí sẽ xuất hiện sau lần tài xế gửi GPS đầu tiên."
              title="Chưa có vị trí tài xế online"
            />
          </div>
        )}
      </main>
    </AccountLayout>
  );
}
