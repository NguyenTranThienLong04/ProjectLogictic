import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { hasValidCoordinates } from './driver-task-map-model';
import { DEFAULT_SELECTED_LOCATION_ZOOM, type LocationViewport } from './location-viewport';

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
  onSelect,
  initialViewport,
}: {
  ariaLabel?: string;
  markers: MapMarker[];
  polylines?: MapPolyline[];
  onSelect?: (point: { latitude: number; longitude: number }) => void;
  initialViewport?: LocationViewport;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const initialSelection = useRef(onSelect ? markers.find(hasValidCoordinates) : undefined);
  // Snapshot on mount: form rerenders and user selection must never reset the viewport.
  const openingViewport = useRef(initialViewport);

  const selection = useRef(onSelect);
  const [tileState, setTileState] = useState('loading');
  useEffect(() => {
    selection.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!element.current || map.current) return;
    map.current = L.map(element.current, {
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView(
      initialSelection.current
        ? [initialSelection.current.latitude, initialSelection.current.longitude]
        : openingViewport.current && hasValidCoordinates(openingViewport.current.center)
          ? [openingViewport.current.center.latitude, openingViewport.current.center.longitude]
          : [0, 0],
      initialSelection.current ? DEFAULT_SELECTED_LOCATION_ZOOM : openingViewport.current?.zoom ?? 2,
    );
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });
    const loadedTiles = new Set<HTMLElement>();
    const failedTiles = new Set<HTMLElement>();
    tiles.on('loading', () => setTileState('loading'));
    tiles.on('tileload', (event: L.TileEvent) => {
      loadedTiles.add(event.tile);
      failedTiles.delete(event.tile);
    });
    tiles.on('tileerror', (event: L.TileErrorEvent) => {
      failedTiles.add(event.tile);
    });
    tiles.on('tileunload', (event: L.TileEvent) => {
      loadedTiles.delete(event.tile);
      failedTiles.delete(event.tile);
    });
    // Leaflet fires load when requests settle, including failed requests.
    // A single failed tile must not mark the usable base map as unavailable.
    tiles.on('load', () => {
      setTileState(failedTiles.size === 0 ? 'ready' : loadedTiles.size > 0 ? 'partial' : 'error');
    });
    tiles.addTo(map.current);
    const select = (point: L.LatLng) =>
      selection.current?.({
        latitude: Number(point.lat.toFixed(6)),
        longitude: Number(point.wrap().lng.toFixed(6)),
      });
    map.current.on('click', (event: L.LeafletMouseEvent) => select(event.latlng));
    map.current.on('keypress', (event: L.LeafletKeyboardEvent) => {
      if (event.originalEvent.key === 'Enter' && map.current) select(map.current.getCenter());
    });
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
      if (onSelect) {
        L.marker([marker.latitude, marker.longitude], {
          draggable: true,
          title: marker.label,
          icon: L.divIcon({
            className: '',
            html: '<span class="block size-6 rounded-full border-4 border-primary bg-surface shadow-surface"></span>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        })
          .on('dragend', (event: L.DragEndEvent) => {
            const point = (event.target as L.Marker).getLatLng();
            onSelect({
              latitude: Number(point.lat.toFixed(6)),
              longitude: Number(point.wrap().lng.toFixed(6)),
            });
          })
          .addTo(layer.current);
        continue;
      }
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
    if (onSelect) return;
    if (points.length === 1) map.current.setView(points[0], 14, { animate: false });
    if (points.length > 1)
      map.current.fitBounds(points, { maxZoom: 15, padding: [40, 40], animate: false });
  }, [markers, polylines, onSelect]);

  return (
    <>
      {onSelect && tileState !== 'ready' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {tileState === 'error'
            ? 'Không tải được bản đồ. Đóng và mở lại để thử lại.'
            : tileState === 'partial'
              ? 'Một phần bản đồ chưa tải được. Bạn vẫn có thể chọn vị trí hoặc đóng và mở lại để thử lại.'
              : 'Đang tải bản đồ…'}
        </p>
      ) : null}
      <div
        aria-label={ariaLabel}
        className="h-72 overflow-hidden rounded-surface border border-border bg-surface shadow-surface sm:h-80 lg:h-96"
        ref={element}
        role="region"
        tabIndex={0}
      />
    </>
  );
}
