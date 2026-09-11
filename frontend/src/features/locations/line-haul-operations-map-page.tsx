import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { createOperationsSocket } from '../../services/operations-socket';
import { formatDateTime } from '../../utils/format';
import { formatRouteDistance, formatRouteDuration } from '../../utils/route-metric';
import { AccountLayout } from '../auth/components/account-layout';
import { useAuth } from '../auth/auth-context';
import { listActiveLineHaulLocations } from './location-api';
import {
  buildLineHaulTripMarkers,
  buildLineHaulTripPolyline,
  effectiveLineHaulLocationState,
  lineHaulFreshnessCopy,
} from './line-haul-location-model';
import { LocationMap } from './location-map';
import type {
  LineHaulLocation,
  LineHaulRouteDeviationChanged,
  LineHaulRouteUpdated,
  LineHaulTripEnded,
  LineHaulTripLocation,
} from './location-types';

const QUERY_KEY = ['active-line-haul-locations'] as const;

export function LineHaulOperationsMapPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setClockTick] = useState(0);
  const locations = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listActiveLineHaulLocations,
    refetchInterval: 20_000,
  });
  const tripIds = useMemo(
    () =>
      (locations.data ?? [])
        .map((trip) => trip.tripId)
        .sort()
        .join(','),
    [locations.data],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tripIds) return;
    const socket = createOperationsSocket();
    const subscribe = () => {
      for (const tripId of tripIds.split(',')) {
        socket.emit('linehaul.trip.subscribe', { tripId }, (response: { subscribed: boolean }) => {
          if (!response.subscribed) void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        });
      }
    };
    socket.on('connect', () => {
      subscribe();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
    if (socket.connected) subscribe();
    socket.on('linehaul.location.updated', (payload: LineHaulLocation) => {
      queryClient.setQueryData<LineHaulTripLocation[]>(QUERY_KEY, (items = []) =>
        items.map((item) =>
          item.tripId === payload.tripId
            ? {
                ...item,
                locationState: 'CURRENT',
                location: payload,
                lastCapturedAt: payload.capturedAt,
              }
            : item,
        ),
      );
    });
    socket.on('linehaul.route.deviation.changed', (payload: LineHaulRouteDeviationChanged) => {
      queryClient.setQueryData<LineHaulTripLocation[]>(QUERY_KEY, (items = []) =>
        items.map((item) =>
          item.tripId === payload.tripId ? { ...item, deviation: payload } : item,
        ),
      );
    });
    socket.on('linehaul.route.updated', (payload: LineHaulRouteUpdated) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['line-haul-trip', payload.tripId] });
    });
    socket.on('linehaul.trip.ended', (payload: LineHaulTripEnded) => {
      queryClient.setQueryData<LineHaulTripLocation[]>(QUERY_KEY, (items = []) =>
        items.filter((item) => item.tripId !== payload.tripId),
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient, tripIds]);

  if (locations.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải bản đồ chuyến liên kho" />
      </AccountLayout>
    );
  }

  const trips = locations.data ?? [];
  const markers = trips.flatMap((trip) =>
    buildLineHaulTripMarkers(trip, { includeEndpoints: true }),
  );
  const polylines = trips.flatMap(buildLineHaulTripPolyline);
  const currentCount = trips.filter(
    (trip) => effectiveLineHaulLocationState(trip) === 'CURRENT',
  ).length;
  const detailBase =
    user?.role === 'ADMIN'
      ? '/admin/line-haul/trips'
      : user?.role === 'WAREHOUSE_STAFF'
        ? '/warehouse/line-haul'
        : '/dispatcher/line-haul';

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          description="Chỉ hiển thị chuyến IN_TRANSIT được backend cấp quyền. Socket cập nhật marker; API làm mới dự phòng mỗi 20 giây."
          eyebrow={user?.role === 'WAREHOUSE_STAFF' ? 'Warehouse operations' : 'Fleet operations'}
          meta={
            <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              {currentCount}/{trips.length} chuyến có GPS hiện tại
            </span>
          }
          title="Bản đồ chuyến liên kho"
        />

        {locations.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(locations.error)}
              onRetry={() => void locations.refetch()}
              title="Không thể tải dữ liệu chuyến liên kho"
            />
          </div>
        ) : trips.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              description="Chuyến sẽ xuất hiện sau khi Dispatcher chuyển READY sang IN_TRANSIT. Chuyến ARRIVED được gỡ ngay khỏi bản đồ."
              title="Không có chuyến liên kho đang chạy"
            />
          </div>
        ) : (
          <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(20rem,1fr)]">
            <section
              aria-labelledby="line-haul-fleet-map-heading"
              className="min-w-0 rounded-surface border border-border bg-surface p-3 shadow-surface sm:p-4"
            >
              <div className="px-1 pb-3">
                <h2 className="text-lg font-semibold text-ink" id="line-haul-fleet-map-heading">
                  Vị trí phương tiện hiện tại
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Marker quá 20 giây tự ẩn; chọn marker để xem chuyến, tài xế và biển số.
                </p>
              </div>
              {markers.length > 0 ? (
                <LocationMap
                  ariaLabel="Bản đồ vị trí hiện tại của các chuyến liên kho được cấp quyền"
                  markers={markers}
                  polylines={polylines}
                />
              ) : (
                <div className="h-72 sm:h-80 lg:h-96">
                  <EmptyState
                    compact
                    description="Các chuyến vẫn có trong danh sách bên cạnh với trạng thái GPS cụ thể."
                    title="Chưa có marker hiện tại"
                  />
                </div>
              )}
            </section>

            <section aria-labelledby="line-haul-fleet-list-heading" className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink" id="line-haul-fleet-list-heading">
                  Chuyến đang chạy
                </h2>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {trips.length} chuyến
                </span>
              </div>
              <div className="grid gap-3">
                {trips.map((trip) => {
                  const freshness = lineHaulFreshnessCopy(trip);
                  return (
                    <article
                      className="rounded-surface border border-border bg-surface p-4 shadow-surface"
                      key={trip.tripId}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            className="focus-ring rounded-control font-mono text-sm font-bold text-primary hover:underline"
                            to={`${detailBase}/${trip.tripId}`}
                          >
                            {trip.tripCode}
                          </Link>
                          <p className="mt-1 wrap-anywhere text-sm font-semibold text-ink">
                            {trip.origin.code} → {trip.destination.code}
                          </p>
                        </div>
                        <LineHaulTripStatusBadge status={trip.status} />
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm">
                        <TripItem
                          label="Tài xế"
                          value={`${trip.driver.fullName} · ${trip.driver.employeeCode}`}
                        />
                        <TripItem
                          label="Xe"
                          value={`${trip.vehicle.vehicleCode} · ${trip.vehicle.licensePlate}`}
                        />
                        <TripItem
                          label="Khởi hành"
                          value={
                            trip.departedAt ? formatDateTime(trip.departedAt) : 'Chưa ghi nhận'
                          }
                        />
                      </dl>
                      <p className={freshnessClass(freshness.tone)} role="status">
                        {freshness.label}
                        {trip.lastCapturedAt ? ` · ${formatDateTime(trip.lastCapturedAt)}` : ''}
                      </p>
                      <p className={deviationClass(trip.deviation.state)} role="status">
                        <span className="font-bold">{deviationLabel(trip.deviation.state)}</span>
                        {trip.deviation.distanceFromRouteMeters !== null
                          ? ` · Cách tuyến ${formatRouteDistance(trip.deviation.distanceFromRouteMeters)}`
                          : ''}
                        {trip.deviation.detectedAt
                          ? ` · ${formatDateTime(trip.deviation.detectedAt)}`
                          : ''}
                      </p>
                      {trip.remainingRoute ? (
                        <p className="mt-2 text-sm font-medium tabular-nums text-ink">
                          Còn {formatRouteDistance(trip.remainingRoute.distanceMeters)}
                          {trip.remainingRoute.durationSeconds !== null
                            ? ` · ETA ${formatRouteDuration(trip.remainingRoute.durationSeconds)}`
                            : ' · Chưa có ETA'}
                        </p>
                      ) : null}
                      {!trip.route?.geometry ? (
                        <p className="mt-2 text-sm font-semibold text-muted-foreground">
                          Chưa có dữ liệu tuyến đường
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </AccountLayout>
  );
}

function deviationLabel(state: LineHaulTripLocation['deviation']['state']): string {
  if (state === 'DEVIATED') return 'Lệch tuyến';
  if (state === 'ON_ROUTE') return 'Đúng tuyến';
  return 'Chưa xác định trạng thái tuyến';
}

function deviationClass(state: LineHaulTripLocation['deviation']['state']): string {
  const shared = 'mt-2 rounded-control border px-3 py-2 text-sm leading-6';
  if (state === 'DEVIATED') return `${shared} border-danger/30 bg-danger-soft text-danger`;
  if (state === 'ON_ROUTE') return `${shared} border-success/30 bg-success-soft text-emerald-900`;
  return `${shared} border-border bg-surface-muted text-muted-foreground`;
}

function TripItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere font-semibold text-ink">{value}</dd>
    </div>
  );
}

function freshnessClass(tone: 'current' | 'warning' | 'muted' | 'danger'): string {
  const shared = 'mt-3 rounded-control border px-3 py-2 text-sm font-semibold leading-6';
  if (tone === 'current') return `${shared} border-primary/20 bg-primary-soft text-primary-strong`;
  if (tone === 'warning') return `${shared} border-warning/30 bg-warning-soft text-warning`;
  if (tone === 'danger') return `${shared} border-danger/30 bg-danger-soft text-danger`;
  return `${shared} border-border bg-surface-muted text-muted-foreground`;
}
