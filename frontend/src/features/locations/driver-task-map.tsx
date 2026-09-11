import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import {
  buildGoogleMapsDirectionsUrl,
  buildTaskMapMarkers,
  hasValidCoordinates,
  resolveDriverLocationState,
} from './driver-task-map-model';
import { getMyDriverLocation } from './location-api';
import { LocationMap } from './location-map';
import type { DriverLocation, DriverTaskLocation } from './location-types';

const targetCopy = {
  PICKUP: {
    eyebrow: 'Điểm lấy hàng',
    title: 'Bản đồ đến người gửi',
  },
  DESTINATION_WAREHOUSE: {
    eyebrow: 'Nhận hàng tại kho',
    title: 'Bản đồ đến kho đích',
  },
  RECEIVER: {
    eyebrow: 'Giao hàng chặng cuối',
    title: 'Bản đồ đến người nhận',
  },
} as const;

export function DriverTaskMap({ target }: { target: DriverTaskLocation | null }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const [lastKnownLocation, setLastKnownLocation] = useState<DriverLocation | null>(
    () => queryClient.getQueryData<DriverLocation>(['driver-current-location']) ?? null,
  );
  const location = useQuery({
    queryKey: ['driver-current-location'],
    queryFn: async () => {
      const current = await getMyDriverLocation();
      if (current) setLastKnownLocation(current);
      return current;
    },
    refetchInterval: 5_000,
  });

  const driverState = resolveDriverLocationState(location.data, lastKnownLocation);
  const markers = buildTaskMapMarkers(target, driverState);
  const directionsUrl = buildGoogleMapsDirectionsUrl(target);
  const copy = target ? targetCopy[target.kind] : null;
  const targetHasCoordinates = hasValidCoordinates(target);

  return (
    <section
      aria-labelledby={headingId}
      className="driver-task-map rounded-surface border border-border bg-surface p-3 shadow-surface sm:p-4"
    >
      <div className="px-1 pb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-primary">
          {copy?.eyebrow ?? 'Điểm đến nhiệm vụ'}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-ink" id={headingId}>
          {copy?.title ?? 'Bản đồ nhiệm vụ'}
        </h2>
        {target ? (
          <p className="mt-1 wrap-anywhere text-sm leading-6 text-muted-foreground">
            {target.label} · {target.address || 'Chưa có địa chỉ mô tả'}
          </p>
        ) : null}
      </div>

      {markers.length > 0 ? (
        <>
          <LocationMap
            ariaLabel={`${copy?.title ?? 'Bản đồ nhiệm vụ'}: vị trí tài xế và điểm đến được phép`}
            markers={markers}
          />
          <ul
            aria-label="Chú thích bản đồ"
            className="mt-3 grid gap-2 text-sm font-medium text-ink sm:grid-cols-2"
          >
            {markers.map((marker) => (
              <li
                className="flex min-h-12 items-center gap-3 rounded-control bg-surface-muted px-3"
                key={marker.id}
              >
                <span
                  aria-hidden="true"
                  className={`size-3 shrink-0 rounded-full ring-2 ring-offset-2 ${marker.tone === 'destination' ? 'bg-accent ring-accent-strong' : 'bg-primary ring-primary-strong'}`}
                />
                <span>{marker.label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : location.isPending ? (
        <div className="grid h-72 place-items-center rounded-surface border border-dashed border-border-strong bg-surface-subtle sm:h-80 lg:h-96">
          <LoadingState compact label="Đang tải vị trí cho bản đồ" />
        </div>
      ) : (
        <div className="h-72 sm:h-80 lg:h-96">
          <EmptyState
            compact
            description="Không có tọa độ hiện tại nào để đặt ghim. Hệ thống không tự đoán vị trí."
            title="Chưa thể đặt ghim trên bản đồ"
          />
        </div>
      )}

      {!targetHasCoordinates && target ? (
        <p
          className="mt-3 rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-medium leading-6 text-warning"
          role="status"
        >
          Điểm đến chưa có tọa độ chính xác nên không đặt ghim. Nút chỉ đường sẽ chuyển địa chỉ sang
          nhà cung cấp bản đồ để bạn xác nhận.
        </p>
      ) : null}

      <div className="mt-3 min-h-24" aria-live="polite">
        {location.isPending ? (
          <LoadingState compact label="Đang tải GPS hiện tại của bạn" />
        ) : location.isError ? (
          <ErrorState
            compact
            message={getApiErrorMessage(location.error)}
            onRetry={() => void location.refetch()}
            title="Không thể tải GPS hiện tại"
          />
        ) : driverState.status === 'current' ? (
          <p
            className="rounded-control border border-primary/20 bg-primary-soft px-4 py-3 text-sm font-medium leading-6 text-primary-strong"
            role="status"
          >
            GPS hiện tại · cập nhật{' '}
            {dateTimeFormatter.format(new Date(driverState.location.updatedAt))}
          </p>
        ) : driverState.status === 'stale' ? (
          <p
            className="rounded-control border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-medium leading-6 text-warning"
            role="status"
          >
            Vị trí gần nhất đã quá 20 giây và được ẩn khỏi bản đồ. Kiểm tra quyền vị trí hoặc kết
            nối mạng rồi thử lại.
          </p>
        ) : (
          <p
            className="rounded-control border border-border-strong bg-surface-muted px-4 py-3 text-sm font-medium leading-6 text-muted-foreground"
            role="status"
          >
            Chưa có GPS hiện tại. Hãy bật quyền vị trí và giữ ứng dụng online; dữ liệu quá 20 giây
            sẽ tự hết hạn.
          </p>
        )}
      </div>

      {directionsUrl && target ? (
        <a
          aria-label={`Mở chỉ đường đến ${target.label} bằng Google Maps`}
          className="focus-ring ui-transition mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-primary bg-surface px-4 font-semibold text-primary transition-colors hover:bg-primary-soft active:bg-blue-100 sm:w-auto"
          href={directionsUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <svg
            aria-hidden="true"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="m14 4 6 6-6 6" />
            <path d="M4 20v-5a5 5 0 0 1 5-5h11" />
          </svg>
          Mở chỉ đường
        </a>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Chỉ đường mở bằng Google Maps; hệ thống không tự tính tuyến đường hoặc ETA.
      </p>
    </section>
  );
}
