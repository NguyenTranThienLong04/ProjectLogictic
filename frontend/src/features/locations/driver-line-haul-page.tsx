import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { formatDateTime } from '../../utils/format';
import { formatRouteDistance, formatRouteDuration } from '../../utils/route-metric';
import { AccountLayout } from '../auth/components/account-layout';
import { useDriverLocationProvider } from './driver-location-context';
import {
  buildLineHaulTripMarkers,
  buildLineHaulTripPolyline,
  effectiveLineHaulLocationState,
  lineHaulFreshnessCopy,
} from './line-haul-location-model';
import { LocationMap } from './location-map';

export function DriverLineHaulPage() {
  const {
    activeLineHaulTrip: trip,
    activeTripError,
    activeTripLoading,
    gpsMessage,
    gpsState,
    refreshActiveTrip,
  } = useDriverLocationProvider();

  if (activeTripLoading) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải chuyến liên kho của bạn" />
      </AccountLayout>
    );
  }
  if (activeTripError) {
    return (
      <AccountLayout>
        <ErrorState
          message={getApiErrorMessage(activeTripError)}
          onRetry={refreshActiveTrip}
          title="Không thể tải ngữ cảnh GPS liên kho"
        />
      </AccountLayout>
    );
  }
  if (!trip) {
    return (
      <AccountLayout>
        <PageHeader
          description="Màn hình này tự kích hoạt khi bạn được phân công một chuyến liên kho active."
          eyebrow="Driver workspace"
          title="Chuyến liên kho"
        />
        <div className="mt-6">
          <EmptyState
            description="Bạn chưa sở hữu chuyến PLANNED, READY hoặc IN_TRANSIT nào. GPS chặng cuối vẫn dùng luồng hiện tại."
            title="Chưa có chuyến liên kho active"
          />
        </div>
      </AccountLayout>
    );
  }

  const locationState = effectiveLineHaulLocationState(trip);
  const freshness = lineHaulFreshnessCopy(trip);
  const markers = buildLineHaulTripMarkers(trip);
  const polylines = buildLineHaulTripPolyline(trip);
  const gpsEnabled = trip.status === 'IN_TRANSIT';

  return (
    <AccountLayout>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          description="GPS 5 giây/lần, được lưu tạm 20 giây và chỉ phát vào đúng room của chuyến."
          eyebrow="Driver workspace"
          meta={<LineHaulTripStatusBadge status={trip.status} />}
          title={gpsEnabled ? 'Chuyến liên kho đang chạy' : 'Chuyến liên kho được phân công'}
        />

        <section
          aria-labelledby="line-haul-driver-summary"
          className="mt-6 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6"
        >
          <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm font-bold text-primary">{trip.tripCode}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink" id="line-haul-driver-summary">
                {trip.origin.code} → {trip.destination.code}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {trip.origin.name} → {trip.destination.name}
              </p>
            </div>
            <LineHaulTripStatusBadge status={trip.status} />
          </div>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <SummaryItem
              label="Phương tiện"
              value={`${trip.vehicle.vehicleCode} · ${trip.vehicle.licensePlate}`}
            />
            <SummaryItem label="Loại xe" value={trip.vehicle.vehicleType} />
            <SummaryItem
              label="Khởi hành"
              value={trip.departedAt ? formatDateTime(trip.departedAt) : 'Chưa xuất phát'}
            />
          </dl>
        </section>

        <section
          aria-labelledby="line-haul-driver-map"
          className="mt-6 rounded-surface border border-border bg-surface p-3 shadow-surface sm:p-4"
        >
          <div className="px-1 pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-primary">
              Theo dõi phương tiện
            </p>
            <h2 className="mt-1 text-lg font-semibold text-ink" id="line-haul-driver-map">
              Vị trí trên tuyến liên kho
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Tuyến hiển thị để theo dõi vận hành; ứng dụng không cung cấp chỉ đường từng chặng.
            </p>
          </div>

          {markers.length > 0 || polylines.length > 0 ? (
            <LocationMap
              ariaLabel={`Bản đồ ${trip.tripCode}: xe hiện tại, kho đi và kho đến`}
              markers={markers}
              polylines={polylines}
            />
          ) : (
            <div className="h-72 sm:h-80 lg:h-96">
              <EmptyState
                compact
                description="Các điểm không có tọa độ sẽ không được suy đoán hoặc đặt ghim giả."
                title="Chưa có vị trí để hiển thị"
              />
            </div>
          )}

          <ul aria-label="Chú thích bản đồ" className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <LegendItem label="Xe / tài xế hiện tại" tone="driver" />
            <LegendItem label={`Kho đi · ${trip.origin.code}`} tone="origin" />
            <LegendItem label={`Kho đến · ${trip.destination.code}`} tone="destination" />
          </ul>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className={deviationClass(trip.deviation.state)} role="status">
              <p className="font-bold">{deviationLabel(trip.deviation.state)}</p>
              <p className="mt-1 text-sm tabular-nums">
                {trip.deviation.distanceFromRouteMeters !== null
                  ? `Cách tuyến ${formatRouteDistance(trip.deviation.distanceFromRouteMeters)}`
                  : 'Cần GPS hiện tại và dữ liệu tuyến đường để xác định.'}
              </p>
            </div>
            <div className="rounded-control border border-border bg-surface-subtle px-4 py-3">
              <p className="font-bold text-ink">Quãng đường còn lại</p>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {trip.remainingRoute
                  ? `${formatRouteDistance(trip.remainingRoute.distanceMeters)}${
                      trip.remainingRoute.durationSeconds !== null
                        ? ` · ETA ${formatRouteDuration(trip.remainingRoute.durationSeconds)}`
                        : ' · Chưa có ETA'
                    }`
                  : 'Chưa có GPS hiện tại để tính.'}
              </p>
            </div>
          </div>
          {!trip.route?.geometry ? (
            <p className="mt-3 rounded-control border border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
              Chưa có dữ liệu tuyến đường
            </p>
          ) : null}

          <div aria-live="polite" className="mt-3">
            <p className={freshnessClass(freshness.tone)} role="status">
              {freshness.label}
              {gpsState === 'LOCATING' ? ' · Đang chờ tín hiệu GPS thiết bị' : ''}
            </p>
            {gpsMessage ? (
              <p
                className="mt-2 rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-medium leading-6 text-warning"
                role="alert"
              >
                {gpsMessage}
              </p>
            ) : null}
            {!gpsEnabled ? (
              <p
                className="mt-2 rounded-control border border-border-strong bg-surface-muted px-4 py-3 text-sm font-medium leading-6 text-muted-foreground"
                role="status"
              >
                Gửi GPS đang bị vô hiệu hóa. Dispatcher cần chuyển chuyến từ READY sang IN_TRANSIT.
              </p>
            ) : locationState === 'STALE' ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Vị trí quá 20 giây đã được ẩn khỏi bản đồ; hãy kiểm tra quyền vị trí và kết nối
                mạng.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </AccountLayout>
  );
}

function deviationLabel(state: 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN'): string {
  if (state === 'DEVIATED') return 'Lệch tuyến';
  if (state === 'ON_ROUTE') return 'Đúng tuyến';
  return 'Chưa xác định trạng thái tuyến';
}

function deviationClass(state: 'ON_ROUTE' | 'DEVIATED' | 'UNKNOWN'): string {
  const shared = 'rounded-control border px-4 py-3';
  if (state === 'DEVIATED') return `${shared} border-danger/30 bg-danger-soft text-danger`;
  if (state === 'ON_ROUTE') return `${shared} border-success/30 bg-success-soft text-emerald-900`;
  return `${shared} border-border bg-surface-muted text-muted-foreground`;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 wrap-anywhere font-semibold text-ink">{value}</dd>
    </div>
  );
}

function LegendItem({ label, tone }: { label: string; tone: 'driver' | 'origin' | 'destination' }) {
  const color =
    tone === 'destination'
      ? 'bg-accent ring-accent-strong'
      : tone === 'origin'
        ? 'bg-muted-foreground ring-ink'
        : 'bg-primary ring-primary-strong';
  return (
    <li className="flex min-h-12 items-center gap-3 rounded-control bg-surface-muted px-3 font-medium text-ink">
      <span
        aria-hidden="true"
        className={`size-3 shrink-0 rounded-full ring-2 ring-offset-2 ${color}`}
      />
      <span>{label}</span>
    </li>
  );
}

function freshnessClass(tone: 'current' | 'warning' | 'muted' | 'danger'): string {
  if (tone === 'current') {
    return 'rounded-control border border-primary/20 bg-primary-soft px-4 py-3 text-sm font-semibold leading-6 text-primary-strong';
  }
  if (tone === 'warning') {
    return 'rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold leading-6 text-warning';
  }
  if (tone === 'danger') {
    return 'rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold leading-6 text-danger';
  }
  return 'rounded-control border border-border-strong bg-surface-muted px-4 py-3 text-sm font-semibold leading-6 text-muted-foreground';
}
