import type { DriverGpsState } from './driver-location-context';
import { DRIVER_LOCATION_TTL_MS } from './driver-task-map-model.ts';

export const DRIVER_GPS_INTERVAL_MS = 5_000;
type Point = { latitude: number; longitude: number };
type Sample = Point & { timestamp: number };

// One polling loop per mounted Driver session. Fresh acquisition on every tick
// also works for a stationary device; old coordinates are never re-stamped.
export function startDriverGpsPublisher(options: {
  locate: () => Promise<Sample>;
  publish: (point: Point, signal: AbortSignal) => Promise<unknown>;
  onState: (state: DriverGpsState, message: string | null) => void;
  onPublishError: (error: unknown) => { message: string; stop: boolean };
}) {
  let stopped = false;
  let pending = false;
  let lastSuccess: number | null = null;
  const startedAt = Date.now();
  const controller = new AbortController();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    controller.abort();
  };
  const tick = async () => {
    if (stopped) return;
    if (Date.now() - (lastSuccess ?? startedAt) >= DRIVER_LOCATION_TTL_MS) {
      options.onState(
        'STALE',
        'Chưa có vị trí mới được gửi thành công. Kiểm tra định vị và kết nối mạng.',
      );
    }
    if (pending) return;
    pending = true;
    try {
      let sample: Sample;
      try {
        sample = await options.locate();
      } catch (error) {
        if (stopped) return;
        const denied =
          typeof error === 'object' && error !== null && 'code' in error && error.code === 1;
        options.onState(
          denied ? 'PERMISSION_DENIED' : 'STALE',
          denied
            ? 'Hãy cho phép vị trí trong cài đặt trình duyệt rồi thử lại.'
            : 'Thiết bị chưa cung cấp được vị trí mới. Kiểm tra định vị và thử lại.',
        );
        if (denied) stop();
        return;
      }
      if (stopped) return;
      const age = Date.now() - sample.timestamp;
      if (!Number.isFinite(age) || age < 0 || age >= DRIVER_LOCATION_TTL_MS) {
        options.onState('STALE', 'Thiết bị chỉ cung cấp vị trí cũ. Đang chờ vị trí mới.');
        return;
      }
      const { latitude, longitude } = sample;
      await options.publish({ latitude, longitude }, controller.signal);
      if (stopped) return;
      lastSuccess = sample.timestamp;
      options.onState(
        Date.now() - lastSuccess < DRIVER_LOCATION_TTL_MS ? 'CURRENT' : 'STALE',
        null,
      );
    } catch (error) {
      if (stopped) return;
      const failure = options.onPublishError(error);
      options.onState(failure.stop ? 'DISABLED' : 'SERVICE_UNAVAILABLE', failure.message);
      if (failure.stop) stop();
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(() => void tick(), DRIVER_GPS_INTERVAL_MS);
  options.onState('LOCATING', null);
  // Defer the initial acquisition so React StrictMode's discarded mount cannot
  // prompt or publish. Cleanup also fences late geolocation/HTTP callbacks.
  void Promise.resolve().then(tick);
  return stop;
}

export function locateBrowserPosition(): Promise<Sample> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) =>
        resolve({ latitude: coords.latitude, longitude: coords.longitude, timestamp }),
      reject,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}
