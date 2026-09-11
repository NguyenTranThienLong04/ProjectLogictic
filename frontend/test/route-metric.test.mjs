import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCandidateRouteMetric,
  formatRouteDistance,
  formatRouteDuration,
  routeMetricSourceLabel,
} from '../src/utils/route-metric.ts';

test('formats road-route candidate distance and planned duration without provider internals', () => {
  assert.equal(
    formatCandidateRouteMetric({
      distanceMeters: 2_800,
      durationSeconds: 420,
      metricMode: 'ROAD_ROUTE',
    }),
    '2,8 km đường bộ · khoảng 7 phút',
  );
  assert.equal(routeMetricSourceLabel('ROAD_ROUTE'), 'Khoảng cách đường bộ');
});

test('labels Haversine fallback honestly and never fabricates an ETA', () => {
  assert.equal(
    formatCandidateRouteMetric({
      distanceMeters: 3_100,
      durationSeconds: null,
      metricMode: 'HAVERSINE_FALLBACK',
    }),
    '3,1 km · khoảng cách ước tính',
  );
  assert.equal(routeMetricSourceLabel('HAVERSINE_FALLBACK'), 'Khoảng cách ước tính');
  assert.equal(formatRouteDuration(null), 'Không khả dụng');
});

test('formats short and long route metrics with locale-aware units', () => {
  assert.equal(formatRouteDistance(850), '850 m');
  assert.equal(formatRouteDuration(7_560), 'khoảng 2 giờ 6 phút');
});
