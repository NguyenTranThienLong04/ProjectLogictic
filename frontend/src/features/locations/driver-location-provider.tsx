import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Outlet } from 'react-router-dom';
import { subscribeToAuthSession } from '../../services/auth-session';
import { getMyDriverProfile } from '../operations/operations-api';
import {
  DRIVER_GPS_INTERVAL_MS,
  startDriverGpsPublisher,
} from './driver-gps-publisher';
import { locateBrowserPosition } from './browser-location';
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

const UPDATE_INTERVAL_MS = DRIVER_GPS_INTERVAL_MS;
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
  const [retry, setRetry] = useState(0);
  const profile = useQuery({
    queryKey: ['driver-profile'],
    queryFn: getMyDriverProfile,
    enabled: user?.role === 'DRIVER' && user.status === 'ACTIVE',
    refetchInterval: UPDATE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const online =
    user?.status === 'ACTIVE' &&
    !profile.isError &&
    profile.data?.isOnline === true &&
    (profile.data.status === 'AVAILABLE' || profile.data.status === 'BUSY');
  const refetchProfile = profile.refetch;
  const activeTrip = useQuery({
    queryKey: ['my-active-line-haul-trip'],
    queryFn: getMyActiveLineHaulTrip,
    enabled: user?.role === 'DRIVER' && user.status === 'ACTIVE',
    refetchIntervalInBackground: true,
    retry: false,
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

  const canPublish =
    online &&
    !activeTripPending &&
    !activeTripFailed &&
    (!activeTripId || activeTripStatus === 'IN_TRANSIT');
  const userId = user?.id;
  useEffect(() => {
    if (!canPublish || (simulationEnabled && simulationState !== 'running')) return;
    const stop = startDriverGpsPublisher({
      locate: simulationEnabled
        ? async () => {
            const point = simulationRoute[step.current % simulationRoute.length];
            step.current += speed;
            return { ...point, timestamp: Date.now() };
          }
        : locateBrowserPosition,
      publish: (point, signal) =>
        activeTripId
          ? updateLineHaulTripLocation(activeTripId, point, signal)
          : updateDriverLocation(point, signal),
      onState: (state, message) => {
        setGpsState(state);
        setGpsMessage(message);
      },
      onPublishError: (error) => {
        void refetchActiveTrip();
        void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
        return {
          message: getApiErrorMessage(error),
          stop:
            isAxiosError(error) &&
            (error.response?.status === 401 || error.response?.status === 403),
        };
      },
    });
    const unsubscribe = subscribeToAuthSession((session) => {
      if (
        !session ||
        session.user.id !== userId ||
        session.user.role !== 'DRIVER' ||
        session.user.status !== 'ACTIVE'
      )
        stop();
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, [
    canPublish,
    activeTripId,
    userId,
    simulationEnabled,
    simulationState,
    speed,
    retry,
    queryClient,
    refetchActiveTrip,
  ]);

  // Revocation stops on the next permission event; granting again starts a fresh
  // loop without requiring navigation to Map. Browsers without Permissions API
  // still request permission through getCurrentPosition and expose manual retry.
  useEffect(() => {
    if (!canPublish || simulationEnabled || !navigator.permissions) return;
    let disposed = false;
    let permission: PermissionStatus | undefined;
    const changed = () => setRetry((value) => value + 1);
    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (disposed) return;
        permission = result;
        permission.addEventListener('change', changed);
      })
      .catch(() => {
        /* Geolocation remains the permission fallback. */
      });
    return () => {
      disposed = true;
      permission?.removeEventListener('change', changed);
    };
  }, [canPublish, simulationEnabled]);

  const canSimulate = canPublish;
  const effectiveGpsState: DriverGpsState =
    profile.isPending || activeTripPending
      ? 'LOCATING'
      : profile.isError || activeTripFailed
        ? 'SERVICE_UNAVAILABLE'
        : !canPublish || (simulationEnabled && simulationState !== 'running')
          ? 'DISABLED'
          : gpsState;
  const effectiveGpsMessage =
    profile.isError || activeTripFailed
      ? 'Không thể kiểm tra trạng thái nhận việc. GPS đã tạm dừng; hãy kiểm tra kết nối.'
      : !online
        ? 'GPS đã dừng khi ngoại tuyến hoặc tài khoản bị tạm khóa.'
        : activeTripId && activeTripStatus !== 'IN_TRANSIT'
          ? 'GPS liên kho chỉ bắt đầu sau khi chuyến được xuất phát.'
          : gpsMessage;
  const contextValue = useMemo<DriverLocationContextValue>(
    () => ({
      activeLineHaulTrip: activeTripData,
      activeTripLoading: activeTripPending,
      activeTripError,
      gpsState: effectiveGpsState,
      gpsMessage: effectiveGpsMessage,
      refreshActiveTrip: () => void refetchActiveTrip(),
      retryGps: () => {
        setRetry((value) => value + 1);
        void refetchProfile();
        void refetchActiveTrip();
      },
    }),
    [
      activeTripData,
      activeTripError,
      activeTripPending,
      effectiveGpsMessage,
      effectiveGpsState,
      refetchActiveTrip,
      refetchProfile,
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
