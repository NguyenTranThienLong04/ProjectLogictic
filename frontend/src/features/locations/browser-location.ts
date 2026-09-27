export type BrowserLocationSample = { latitude: number; longitude: number; timestamp: number };

// Device acquisition only: no role, simulation, API publication or persistence.
export function locateBrowserPosition(): Promise<BrowserLocationSample> {
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

export function browserLocationErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 1) return 'Quyền vị trí đã bị từ chối. Hãy bật quyền vị trí cho trang này trong cài đặt trình duyệt và bật định vị thiết bị, rồi thử lại. Bạn vẫn có thể tìm địa chỉ hoặc đặt pin thủ công.';
  if (code === 3) return 'Lấy vị trí quá thời gian chờ. Hãy thử lại, tìm địa chỉ hoặc đặt pin thủ công.';
  return 'Không lấy được vị trí thiết bị. Hãy kiểm tra định vị, thử lại, tìm địa chỉ hoặc đặt pin thủ công.';
}
