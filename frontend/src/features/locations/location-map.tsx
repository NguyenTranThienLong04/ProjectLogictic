import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { hasValidCoordinates } from './driver-task-map-model';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  tone?: 'driver' | 'origin' | 'destination';
}

export interface MapPolyline {
  id: string;
  points: Array<{ latitude: number; longitude: number }>;
  label: string;
  tone?: 'current' | 'planned';
}

const EMPTY_POLYLINES: MapPolyline[] = [];

export function LocationMap({
  ariaLabel = 'Bản đồ vị trí tài xế',
  markers,
  polylines = EMPTY_POLYLINES,
}: {
  ariaLabel?: string;
  markers: MapMarker[];
  polylines?: MapPolyline[];
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!element.current || map.current) return;
    map.current = L.map(element.current, {
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const validMarkers = markers.filter(hasValidCoordinates);
    const points: L.LatLngTuple[] = validMarkers.map((marker) => [
      marker.latitude,
      marker.longitude,
    ]);
    const rootStyle = getComputedStyle(document.documentElement);
    const primaryColor = rootStyle.getPropertyValue('--color-primary').trim();
    const primaryStrongColor = rootStyle.getPropertyValue('--color-primary-strong').trim();
    const accentColor = rootStyle.getPropertyValue('--color-accent').trim();
    const accentStrongColor = rootStyle.getPropertyValue('--color-accent-strong').trim();
    const mutedColor = rootStyle.getPropertyValue('--color-muted-foreground').trim();
    const inkColor = rootStyle.getPropertyValue('--color-ink').trim();
    for (const polyline of polylines) {
      const routePoints = polyline.points
        .filter(hasValidCoordinates)
        .map((point): L.LatLngTuple => [point.latitude, point.longitude]);
      if (routePoints.length < 2) continue;
      points.push(...routePoints);
      const popup = document.createElement('span');
      popup.textContent = polyline.label;
      L.polyline(routePoints, {
        color: polyline.tone === 'planned' ? mutedColor : primaryStrongColor,
        dashArray: polyline.tone === 'planned' ? '8 8' : undefined,
        opacity: polyline.tone === 'planned' ? 0.75 : 0.95,
        weight: polyline.tone === 'planned' ? 4 : 6,
      })
        .bindPopup(popup)
        .addTo(layer.current);
    }
    for (const marker of validMarkers) {
      const destination = marker.tone === 'destination';
      const origin = marker.tone === 'origin';
      const popup = document.createElement('span');
      popup.textContent = marker.label;
      L.circleMarker([marker.latitude, marker.longitude], {
        color: destination ? accentStrongColor : origin ? inkColor : primaryStrongColor,
        fillColor: destination ? accentColor : origin ? mutedColor : primaryColor,
        fillOpacity: 1,
        radius: 9,
        weight: 3,
      })
        .bindPopup(popup)
        .addTo(layer.current);
    }
    if (points.length === 1) map.current.setView(points[0], 14, { animate: false });
    if (points.length > 1)
      map.current.fitBounds(points, { maxZoom: 15, padding: [40, 40], animate: false });
  }, [markers, polylines]);

  return (
    <div
      aria-label={ariaLabel}
      className="h-72 overflow-hidden rounded-surface border border-border bg-surface shadow-surface sm:h-80 lg:h-96"
      ref={element}
      role="region"
    />
  );
}
