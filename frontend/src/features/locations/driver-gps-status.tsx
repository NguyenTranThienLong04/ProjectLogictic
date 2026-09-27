import { useContext } from 'react';
import { Button } from '../../components/ui/button';
import { DriverLocationContext, type DriverGpsState } from './driver-location-context';

const labels: Record<DriverGpsState, string> = {
  CURRENT: 'GPS đang hoạt động',
  LOCATING: 'Đang chờ vị trí',
  PERMISSION_DENIED: 'Quyền vị trí bị từ chối',
  STALE: 'GPS đã mất/stale',
  POSITION_UNAVAILABLE: 'GPS đã mất/stale',
  SERVICE_UNAVAILABLE: 'GPS đã mất/stale',
  DISABLED: 'GPS đã dừng',
};

export function DriverGpsStatus() {
  const gps = useContext(DriverLocationContext);
  if (!gps) return null;
  const current = gps.gpsState === 'CURRENT';
  return (
    <section
      aria-label="Trạng thái GPS"
      className={`sticky top-0 z-30 border-b px-4 py-3 sm:px-6 lg:px-8 ${current ? 'border-success/30 bg-success-soft text-success' : 'border-warning/30 bg-warning-soft text-ink'}`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1" role="status" aria-atomic="true">
          <p className="text-sm font-semibold">{labels[gps.gpsState]}</p>
          {!current ? (
            <p className="mt-1 text-sm">Bạn cần bật quyền vị trí để nhận nhiệm vụ.</p>
          ) : null}
          {!current && gps.gpsMessage ? <p className="mt-1 text-sm">{gps.gpsMessage}</p> : null}
        </div>
        {!current && gps.gpsState !== 'DISABLED' ? (
          <Button className="min-h-12 shrink-0" variant="secondary" onClick={gps.retryGps}>
            Thử lại GPS
          </Button>
        ) : null}
      </div>
    </section>
  );
}
