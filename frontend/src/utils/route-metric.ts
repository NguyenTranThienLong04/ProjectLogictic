export type RouteMetricMode = 'ROAD_ROUTE' | 'HAVERSINE_FALLBACK';

export interface RouteMetricView {
  distanceMeters: number;
  durationSeconds: number | null;
  mode: RouteMetricMode;
  provider: string;
  calculatedAt: string;
}

const distanceFormatter = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatRouteDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) return `${Math.round(distanceMeters)} m`;
  return `${distanceFormatter.format(distanceMeters / 1_000)} km`;
}

export function formatRouteDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) return 'Không khả dụng';
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `khoảng ${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `khoảng ${hours} giờ ${remainingMinutes} phút`
    : `khoảng ${hours} giờ`;
}

export function routeMetricSourceLabel(mode: RouteMetricMode): string {
  return mode === 'ROAD_ROUTE' ? 'Khoảng cách đường bộ' : 'Khoảng cách ước tính';
}

export function formatCandidateRouteMetric(metric: {
  distanceMeters: number;
  durationSeconds: number | null;
  metricMode: RouteMetricMode;
}): string {
  const distance = formatRouteDistance(metric.distanceMeters);
  return metric.metricMode === 'ROAD_ROUTE' && metric.durationSeconds !== null
    ? `${distance} đường bộ · ${formatRouteDuration(metric.durationSeconds)}`
    : `${distance} · khoảng cách ước tính`;
}
