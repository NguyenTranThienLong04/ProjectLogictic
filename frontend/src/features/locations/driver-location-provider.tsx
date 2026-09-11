import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getApiErrorMessage } from '../../services/api-error';
import { createOperationsSocket } from '../../services/operations-socket';
import { useAuth } from '../auth/auth-context';
import {
  getMyActiveLineHaulTrip,
  updateDriverLocation,
  updateLineHaulTripLocation,
} from './location-api';
import type {
  LineHaulLocation,
  LineHaulRouteDeviationChanged,
  LineHaulRouteUpdated,
  LineHaulTripEnded,
  LineHaulTripLocation,
} from './location-types';
import {
  DriverLocationContext,
  type DriverGpsState,
  type DriverLocationContextValue,
} from './driver-location-context';

const UPDATE_INTERVAL_MS = 5_000;
const simulationRoute = [
  { latitude: 10.7757, longitude: 106.7004 },
  { latitude: 10.7762, longitude: 106.7013 },
  { latitude: 10.777, longitude: 106.702 },
  { latitude: 10.7778, longitude: 106.7028 },
  { latitude: 10.7785, longitude: 106.7036 },
];

type SimulationState = 'idle' | 'running' | 'paused';

export function DriverLocationProvider() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mode = import.meta.env.VITE_LOCATION_MODE === 'SIMULATION' ? 'SIMULATION' : 'REAL';
  const simulationEnabled = import.meta.env.DEV && mode === 'SIMULATION';
  const [simulationState, setSimulationState] = useState<SimulationState>('idle');
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [gpsState, setGpsState] = useState<DriverGpsState>('LOCATING');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const step = useRef(0);
  const lastSentAt = useRef(0);
  const activeTrip = useQuery({
    queryKey: ['my-active-line-haul-trip'],
    queryFn: getMyActiveLineHaulTrip,
    enabled: Boolean(user),
    refetchInterval: UPDATE_INTERVAL_MS,
  });
  const activeTripData = activeTrip.data;
  const activeTripError = activeTrip.error;
  const activeTripPending = activeTrip.isPending;
  const activeTripFailed = activeTrip.isError;
  const refetchActiveTrip = activeTrip.refetch;
  const activeTripId = activeTripData?.tripId;
  const activeTripStatus = activeTripData?.status;

  useEffect(() => {
    if (!activeTripId || activeTripStatus !== 'IN_TRANSIT') return;
    const socket = createOperationsSocket();
    const subscribe = () =>
      socket.emit(
        'linehaul.trip.subscribe',
        { tripId: activeTripId },
        (response: { subscribed: boolean }) => {
          if (!response.subscribed) void refetchActiveTrip();
        },
      );
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    socket.on('linehaul.location.updated', (payload: LineHaulLocation) => {
      if (payload.tripId !== activeTripId) return;
      queryClient.setQueryData<LineHaulTripLocation | null>(
        ['my-active-line-haul-trip'],
        (current) =>
          current
            ? {
                ...current,
                locationState: 'CURRENT',
                location: payload,
                lastCapturedAt: payload.capturedAt,
              }
            : current,
      );
    });
    socket.on('linehaul.route.deviation.changed', (payload: LineHaulRouteDeviationChanged) => {
      if (payload.tripId !== activeTripId) return;
      queryClient.setQueryData<LineHaulTripLocation | null>(
        ['my-active-line-haul-trip'],
        (current) => (current ? { ...current, deviation: payload } : current),
      );
    });
    socket.on('linehaul.route.updated', (payload: LineHaulRouteUpdated) => {
      if (payload.tripId === activeTripId) void refetchActiveTrip();
    });
    socket.on('linehaul.trip.ended', (payload: LineHaulTripEnded) => {
      if (payload.tripId === activeTripId) void refetchActiveTrip();
    });
    return () => {
      socket.disconnect();
    };
  }, [activeTripId, activeTripStatus, queryClient, refetchActiveTrip]);

  const sendLocation = useCallback(
    async (point: { latitude: number; longitude: number }) => {
      if (activeTripPending || activeTripFailed) {
        setGpsState('SERVICE_UNAVAILABLE');
        setGpsMessage('Không thể xác định ngữ cảnh GPS hiện tại. Vui lòng thử lại.');
        return;
      }
      if (activeTripData && activeTripData.status !== 'IN_TRANSIT') {
        setGpsState('DISABLED');
        setGpsMessage('GPS liên kho chỉ bắt đầu sau khi chuyến được xuất phát.');
        return;
      }
      try {
        if (activeTripData) {
          await updateLineHaulTripLocation(activeTripData.tripId, point);
        } else {
          await updateDriverLocation(point);
        }
        setGpsState('CURRENT');
        setGpsMessage(null);
      } catch (error) {
        setGpsState('SERVICE_UNAVAILABLE');
        setGpsMessage(getApiErrorMessage(error));
        void refetchActiveTrip();
      }
    },
    [activeTripData, activeTripFailed, activeTripPending, refetchActiveTrip],
  );

  useEffect(() => {
    if (!user || simulationEnabled) return;
    if (activeTripPending || activeTripFailed) return;
    if (activeTripData && activeTripData.status !== 'IN_TRANSIT') return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSentAt.current < UPDATE_INTERVAL_MS) return;
        lastSentAt.current = now;
        void sendLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsState('PERMISSION_DENIED');
          setGpsMessage('Quyền vị trí đang bị từ chối. Hãy cho phép định vị trong trình duyệt.');
        } else {
          setGpsState('POSITION_UNAVAILABLE');
          setGpsMessage(
            error.code === error.TIMEOUT
              ? 'Thiết bị chưa lấy được GPS kịp thời. Kiểm tra tín hiệu và thử lại.'
              : 'Thiết bị chưa cung cấp được vị trí hiện tại.',
          );
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeTripData, activeTripFailed, activeTripPending, sendLocation, simulationEnabled, user]);

  useEffect(() => {
    if (simulationState !== 'running') return;
    const timer = window.setInterval(() => {
      const point = simulationRoute[step.current % simulationRoute.length];
      step.current += speed;
      void sendLocation(point);
    }, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [sendLocation, simulationState, speed]);

  const canSimulate =
    !activeTripPending &&
    !activeTripFailed &&
    (!activeTripData || activeTripData.status === 'IN_TRANSIT');
  const effectiveGpsState: DriverGpsState = activeTripPending
    ? 'LOCATING'
    : activeTripFailed
      ? 'SERVICE_UNAVAILABLE'
      : activeTripData && activeTripData.status !== 'IN_TRANSIT'
        ? 'DISABLED'
        : !simulationEnabled && !navigator.geolocation
          ? 'POSITION_UNAVAILABLE'
          : gpsState;
  const effectiveGpsMessage = activeTripFailed
    ? 'Không thể xác định nhiệm vụ GPS hiện tại.'
    : activeTripData && activeTripData.status !== 'IN_TRANSIT'
      ? 'GPS liên kho chỉ bắt đầu sau khi chuyến được xuất phát.'
      : !simulationEnabled && !navigator.geolocation
        ? 'Thiết bị hoặc trình duyệt này không hỗ trợ định vị.'
        : gpsMessage;
  const contextValue = useMemo<DriverLocationContextValue>(
    () => ({
      activeLineHaulTrip: activeTripData,
      activeTripLoading: activeTripPending,
      activeTripError,
      gpsState: effectiveGpsState,
      gpsMessage: effectiveGpsMessage,
      refreshActiveTrip: () => void refetchActiveTrip(),
    }),
    [
      activeTripData,
      activeTripError,
      activeTripPending,
      effectiveGpsMessage,
      effectiveGpsState,
      refetchActiveTrip,
    ],
  );

  return (
    <DriverLocationContext.Provider value={contextValue}>
      <Outlet />
      {simulationEnabled ? (
        <section
          aria-label="GPS simulator development"
          className="mx-3 mb-3 mt-4 rounded-overlay border border-border-strong bg-surface p-4 shadow-floating sm:mx-auto sm:mb-4 sm:max-w-lg"
          role="region"
        >
          <p className="text-base font-semibold text-ink">GPS simulator (development)</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground" role="status">
            {activeTripData
              ? `${activeTripData.tripCode} · ${activeTripData.status === 'IN_TRANSIT' ? 'gửi qua API GPS liên kho' : 'chưa xuất phát'}`
              : 'Gửi qua API GPS tài xế hiện có'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="touch-manipulation px-3 text-sm"
              disabled={!canSimulate || simulationState === 'running'}
              onClick={() => {
                setSimulationState('running');
                const point = simulationRoute[step.current % simulationRoute.length];
                step.current += speed;
                void sendLocation(point);
              }}
            >
              Start
            </Button>
            <Button
              className="touch-manipulation px-3 text-sm"
              disabled={simulationState !== 'running'}
              onClick={() => setSimulationState('paused')}
              variant="secondary"
            >
              Pause
            </Button>
            <Button
              className="touch-manipulation px-3 text-sm"
              disabled={simulationState !== 'paused' || !canSimulate}
              onClick={() => setSimulationState('running')}
              variant="secondary"
            >
              Resume
            </Button>
            <Button
              className="touch-manipulation px-3 text-sm"
              onClick={() => {
                step.current = 0;
                setSimulationState('idle');
              }}
              variant="danger"
            >
              Stop
            </Button>
            {[1, 2, 5].map((value) => (
              <Button
                className="touch-manipulation px-3 text-sm"
                key={value}
                onClick={() => setSpeed(value as 1 | 2 | 5)}
                variant={speed === value ? 'primary' : 'secondary'}
              >
                {value}×
              </Button>
            ))}
          </div>
          {effectiveGpsMessage ? (
            <p className="mt-3 text-sm font-medium text-warning" role="alert">
              {effectiveGpsMessage}
            </p>
          ) : null}
        </section>
      ) : null}
    </DriverLocationContext.Provider>
  );
}
