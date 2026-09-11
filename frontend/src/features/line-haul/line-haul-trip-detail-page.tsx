import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { SelectField } from '../../components/ui/select-field';
import {
  LineHaulTripStatusBadge,
  LineHaulVehicleStatusBadge,
  WarehouseTransferStatusBadge,
} from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { createOperationsSocket } from '../../services/operations-socket';
import {
  formatRouteDistance,
  formatRouteDuration,
  routeMetricSourceLabel,
  type RouteMetricView,
} from '../../utils/route-metric';
import { useAuth } from '../auth/auth-context';
import { AccountLayout } from '../auth/components/account-layout';
import {
  arriveLineHaulTrip,
  assignWarehouseTransferToTrip,
  cancelLineHaulTrip,
  dispatchLineHaulTrip,
  getLineHaulTrip,
  listEligibleWarehouseTransfers,
  prepareLineHaulTrip,
  recalculateLineHaulTripRoute,
  removeWarehouseTransferFromTrip,
} from './line-haul-api';
import { getLineHaulTripLocation } from '../locations/location-api';
import {
  buildLineHaulTripMarkers,
  buildLineHaulTripPolyline,
} from '../locations/line-haul-location-model';
import { LocationMap, type MapPolyline } from '../locations/location-map';
import type {
  LineHaulLocation,
  LineHaulRouteDeviationChanged,
  LineHaulRouteUpdated,
  LineHaulTripEnded,
  LineHaulTripLocation,
} from '../locations/location-types';
import { receiveTransfer } from '../warehouses/warehouses-api';
import { CapacityIndicator } from './capacity-indicator';
import {
  formatCapacityWeight,
  lineHaulDriverLabel,
  lineHaulReceiveProgress,
  lineHaulVehicleLabel,
  warehouseTransferLabel,
} from './line-haul-model';
import { LineHaulSchedulePanel } from './line-haul-schedule-panel';
import type {
  EligibleWarehouseTransfer,
  LineHaulTrip,
  LineHaulTripTransferAssignment,
} from './line-haul-types';

export function LineHaulTripDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [transferSearch, setTransferSearch] = useState('');
  const deferredTransferSearch = useDeferredValue(transferSearch);
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [confirmAssign, setConfirmAssign] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<LineHaulTripTransferAssignment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmPrepare, setConfirmPrepare] = useState(false);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [confirmArrival, setConfirmArrival] = useState(false);
  const [confirmReroute, setConfirmReroute] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<LineHaulTripTransferAssignment | null>(null);
  const [success, setSuccess] = useState('');
  const listPath =
    user?.role === 'ADMIN'
      ? '/admin/line-haul/trips'
      : user?.role === 'WAREHOUSE_STAFF'
        ? '/warehouse/line-haul'
        : '/dispatcher/line-haul';
  const trip = useQuery({
    queryKey: ['line-haul-trip', id],
    queryFn: () => getLineHaulTrip(id),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'IN_TRANSIT' ? 20_000 : false),
  });
  const tripLocation = useQuery({
    queryKey: ['line-haul-trip-location', id],
    queryFn: () => getLineHaulTripLocation(id),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'IN_TRANSIT' ? 20_000 : false),
  });
  const refetchTrip = trip.refetch;
  const refetchTripLocation = tripLocation.refetch;
  const configurable = trip.data?.availableActions.addTransfer === true;
  const eligibleTransfers = useQuery({
    queryKey: ['line-haul-eligible-transfers', id, deferredTransferSearch],
    queryFn: () => listEligibleWarehouseTransfers(id, deferredTransferSearch || undefined),
    enabled: Boolean(id) && configurable,
  });

  const updateTrip = async (updated: LineHaulTrip, message: string) => {
    queryClient.setQueryData(['line-haul-trip', id], updated);
    setSuccess(message);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['line-haul-trips'] }),
      queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-transfers', id] }),
      queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-drivers'] }),
      queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['line-haul-resource-availability'] }),
      queryClient.invalidateQueries({ queryKey: ['line-haul-schedule-board'] }),
    ]);
  };
  const assignMutation = useMutation({
    mutationFn: assignWarehouseTransferToTrip,
    onSuccess: async (updated) => {
      const assignment = updated.transferAssignments.find(
        (item) => item.isActive && item.warehouseTransfer.id === selectedTransferId,
      );
      setConfirmAssign(false);
      setSelectedTransferId('');
      setTransferSearch('');
      await updateTrip(
        updated,
        assignment
          ? `Đã gán ${assignment.warehouseTransfer.transferCode} vào chuyến.`
          : 'Đã cập nhật transfer của chuyến.',
      );
    },
  });
  const removeMutation = useMutation({
    mutationFn: removeWarehouseTransferFromTrip,
    onSuccess: async (updated) => {
      const code = removeTarget?.warehouseTransfer.transferCode;
      setRemoveTarget(null);
      await updateTrip(
        updated,
        code ? `Đã gỡ ${code}; lịch sử association được giữ lại.` : 'Đã gỡ transfer.',
      );
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelLineHaulTrip,
    onSuccess: async (updated) => {
      setConfirmCancel(false);
      setCancelReason('');
      await updateTrip(updated, `Đã hủy chuyến ${updated.tripCode} và giải phóng ownership.`);
    },
  });
  const prepareMutation = useMutation({
    mutationFn: prepareLineHaulTrip,
    onSuccess: async (updated) => {
      setConfirmPrepare(false);
      await updateTrip(updated, `Manifest ${updated.tripCode} đã khóa và sẵn sàng xuất phát.`);
    },
  });
  const dispatchMutation = useMutation({
    mutationFn: dispatchLineHaulTrip,
    onSuccess: async (updated) => {
      setConfirmDispatch(false);
      await updateTrip(updated, `Đã dispatch ${updated.tripCode}; toàn bộ kiện đang trung chuyển.`);
    },
  });
  const arrivalMutation = useMutation({
    mutationFn: arriveLineHaulTrip,
    onSuccess: async (updated) => {
      setConfirmArrival(false);
      await updateTrip(updated, `Đã xác nhận ${updated.tripCode} đến kho đích.`);
    },
  });
  const rerouteMutation = useMutation({
    mutationFn: recalculateLineHaulTripRoute,
    onSuccess: async (updated) => {
      setConfirmReroute(false);
      await queryClient.invalidateQueries({ queryKey: ['line-haul-trip-location', id] });
      await updateTrip(
        updated,
        `Đã tạo tuyến v${updated.currentRoute?.version ?? ''}; tuyến kế hoạch ban đầu vẫn được giữ.`,
      );
    },
  });
  const receiveMutation = useMutation({
    mutationFn: (assignment: LineHaulTripTransferAssignment) =>
      receiveTransfer(trip.data?.destinationWarehouseId ?? '', assignment.warehouseTransfer.id),
    onSuccess: async (_transfer, assignment) => {
      setReceiveTarget(null);
      const refreshed = await trip.refetch();
      if (refreshed.data) {
        await updateTrip(
          refreshed.data,
          `Đã tiếp nhận ${assignment.warehouseTransfer.transferCode} tại kho đích.`,
        );
      }
    },
  });

  useEffect(() => {
    if (!id || trip.data?.status !== 'IN_TRANSIT') return;
    const socket = createOperationsSocket();
    const subscribe = () =>
      socket.emit(
        'linehaul.trip.subscribe',
        { tripId: id },
        (response: { subscribed: boolean }) => {
          if (!response.subscribed) void refetchTrip();
        },
      );
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    socket.on('linehaul.location.updated', (payload: LineHaulLocation) => {
      if (payload.tripId !== id) return;
      queryClient.setQueryData<LineHaulTripLocation>(
        ['line-haul-trip-location', id],
        (currentLocation) =>
          currentLocation
            ? {
                ...currentLocation,
                locationState: 'CURRENT',
                location: payload,
                lastCapturedAt: payload.capturedAt,
              }
            : currentLocation,
      );
    });
    socket.on('linehaul.route.deviation.changed', (payload: LineHaulRouteDeviationChanged) => {
      if (payload.tripId !== id) return;
      queryClient.setQueryData<LineHaulTripLocation>(
        ['line-haul-trip-location', id],
        (currentLocation) =>
          currentLocation ? { ...currentLocation, deviation: payload } : currentLocation,
      );
    });
    socket.on('linehaul.route.updated', (payload: LineHaulRouteUpdated) => {
      if (payload.tripId !== id) return;
      void refetchTrip();
      void refetchTripLocation();
    });
    socket.on('linehaul.trip.ended', (payload: LineHaulTripEnded) => {
      if (payload.tripId !== id) return;
      void refetchTrip();
      void refetchTripLocation();
    });
    return () => {
      socket.disconnect();
    };
  }, [id, queryClient, refetchTrip, refetchTripLocation, trip.data?.status]);

  if (trip.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải chi tiết chuyến liên kho" />
      </AccountLayout>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <AccountLayout>
        <ErrorState
          message={trip.isError ? getApiErrorMessage(trip.error) : 'Không tìm thấy chuyến.'}
          onRetry={() => trip.refetch()}
          title="Không thể tải chuyến liên kho"
        />
      </AccountLayout>
    );
  }

  const current = trip.data;
  const operational = tripLocation.data;
  const isRouteManager = user?.role === 'ADMIN' || user?.role === 'DISPATCHER';
  const mapMarkers = operational ? buildLineHaulTripMarkers(operational) : [];
  const currentPolylines = operational ? buildLineHaulTripPolyline(operational) : [];
  const plannedGeometry = current.plannedRoute?.geometry;
  const routePolylines: MapPolyline[] = [
    ...(current.currentRoute?.version !== current.plannedRoute?.version &&
    plannedGeometry?.points &&
    plannedGeometry.points.length >= 2
      ? [
          {
            id: `planned-route-${current.id}`,
            points: plannedGeometry.points,
            label: 'Tuyến kế hoạch ban đầu · v1',
            tone: 'planned' as const,
          },
        ]
      : []),
    ...currentPolylines,
  ];
  const selectedTransfer = eligibleTransfers.data?.find(
    (transfer) => transfer.id === selectedTransferId,
  );
  const mutationError =
    assignMutation.error ??
    removeMutation.error ??
    cancelMutation.error ??
    prepareMutation.error ??
    dispatchMutation.error ??
    arrivalMutation.error ??
    rerouteMutation.error ??
    receiveMutation.error;
  const transferColumns: DataTableColumn<LineHaulTripTransferAssignment>[] = [
    {
      id: 'transfer',
      header: 'WarehouseTransfer',
      render: (assignment) => (
        <span className="font-mono text-xs font-bold text-primary">
          {assignment.warehouseTransfer.transferCode}
        </span>
      ),
    },
    {
      id: 'shipment',
      header: 'Vận đơn',
      render: (assignment) => (
        <span className="font-mono text-xs font-semibold text-ink">
          {assignment.warehouseTransfer.shipment.trackingCode}
        </span>
      ),
    },
    {
      id: 'transferStatus',
      header: 'Trạng thái transfer',
      render: (assignment) => (
        <WarehouseTransferStatusBadge status={assignment.warehouseTransfer.status} />
      ),
    },
    {
      id: 'package',
      header: 'Kiện hàng',
      render: (assignment) => {
        const packageSnapshot = assignment.warehouseTransfer.shipment.packageSnapshot;
        return (
          <div className="text-sm">
            <p className="font-medium text-ink">{packageSnapshot.description}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {packageSnapshot.packageType} · Tải chuyến{' '}
              {formatCapacityWeight(assignment.warehouseTransfer.loadWeightGrams)}
            </p>
          </div>
        );
      },
    },
    {
      id: 'association',
      header: 'Association',
      render: (assignment) => (
        <span
          className={assignment.isActive ? 'font-semibold text-success' : 'text-muted-foreground'}
        >
          {assignment.isActive
            ? 'Đang thuộc chuyến'
            : `Đã gỡ ${assignment.removedAt ? new Date(assignment.removedAt).toLocaleString('vi-VN') : ''}`}
        </span>
      ),
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (assignment) =>
        assignment.isActive && current.availableActions.removeTransfer ? (
          <Button
            className="w-full md:w-auto"
            disabled={removeMutation.isPending}
            onClick={() => {
              setSuccess('');
              setRemoveTarget(assignment);
            }}
            variant="secondary"
          >
            Gỡ khỏi chuyến
          </Button>
        ) : assignment.isActive &&
          current.availableActions.receiveTransfers &&
          assignment.warehouseTransfer.status === 'IN_TRANSIT' ? (
          <Button
            className="w-full whitespace-nowrap md:w-auto"
            disabled={receiveMutation.isPending}
            loading={receiveMutation.isPending && receiveMutation.variables?.id === assignment.id}
            onClick={() => {
              setSuccess('');
              setReceiveTarget(assignment);
            }}
          >
            Nhận kiện
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Chỉ đọc</span>
        ),
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <Link
          className="focus-ring inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-primary hover:underline"
          to={listPath}
        >
          ← Quay lại danh sách chuyến
        </Link>
        <PageHeader
          description={`${current.originWarehouse.name} → ${current.destinationWarehouse.name}`}
          eyebrow="Điều phối · Chi tiết chuyến"
          meta={<LineHaulTripStatusBadge status={current.status} />}
          title={current.tripCode}
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold text-emerald-900"
          >
            {success}
          </p>
        ) : null}
        {mutationError ? (
          <div className="mt-6">
            <ErrorSummary message={getApiErrorMessage(mutationError)} />
          </div>
        ) : null}

        <section
          aria-label="Thông tin chuyến liên kho"
          className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <InfoCard
            label="Kho xuất phát"
            primary={current.originWarehouse.name}
            secondary={`${current.originWarehouse.address}, ${current.originWarehouse.city}`}
          />
          <InfoCard
            label="Kho đích"
            primary={current.destinationWarehouse.name}
            secondary={`${current.destinationWarehouse.address}, ${current.destinationWarehouse.city}`}
          />
          <InfoCard
            label="Tài xế"
            primary={lineHaulDriverLabel(current.driver)}
            secondary="Capability LINE_HAUL"
          />
          <InfoCard
            label="Xe tuyến"
            primary={lineHaulVehicleLabel(current.vehicle)}
            secondary={`${current.vehicle.vehicleType} · ${formatCapacityWeight(current.vehicle.capacityWeightGrams)}`}
          >
            <div className="mt-3">
              <LineHaulVehicleStatusBadge status={current.vehicle.status} />
            </div>
          </InfoCard>
        </section>

        <section
          aria-labelledby="manifest-capacity-title"
          className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-start">
            <div>
              <h2 className="text-lg font-semibold text-ink" id="manifest-capacity-title">
                Sức tải manifest
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Tổng tải lấy từ package snapshot đã xác minh. Backend so sánh integer grams; phần
                trăm chỉ hỗ trợ quan sát.
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoValue
                  label="Số kiện active"
                  value={`${current.manifest.totalTransfers.toLocaleString('vi-VN')} kiện`}
                />
                <InfoValue
                  label="Còn lại"
                  value={formatCapacityWeight(current.manifest.remainingCapacityWeightGrams)}
                />
              </dl>
              {current.manifest.preparedManifestWeightGrams !== null &&
              current.manifest.preparedVehicleCapacityWeightGrams !== null ? (
                <p className="mt-4 rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm leading-6 text-muted-foreground">
                  Snapshot READY:{' '}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatCapacityWeight(current.manifest.preparedManifestWeightGrams)} /{' '}
                    {formatCapacityWeight(current.manifest.preparedVehicleCapacityWeightGrams)}
                  </span>
                </p>
              ) : null}
            </div>
            <CapacityIndicator
              capacityUtilizationPercent={current.manifest.capacityUtilizationPercent}
              manifestWeightGrams={current.manifest.manifestWeightGrams}
              remainingCapacityWeightGrams={current.manifest.remainingCapacityWeightGrams}
              vehicleCapacityWeightGrams={current.manifest.vehicleCapacityWeightGrams}
            />
          </div>
        </section>

        <section className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoValue
              label="Bắt đầu lịch"
              value={
                current.scheduledStartAt
                  ? new Date(current.scheduledStartAt).toLocaleString('vi-VN')
                  : 'Chưa lên lịch'
              }
            />
            <InfoValue
              label="Kết thúc lịch"
              value={
                current.scheduledEndAt
                  ? new Date(current.scheduledEndAt).toLocaleString('vi-VN')
                  : 'Chưa lên lịch'
              }
            />
            <InfoValue
              label="Khởi hành thực tế"
              value={
                current.departedAt ? new Date(current.departedAt).toLocaleString('vi-VN') : '—'
              }
            />
            <InfoValue
              label="Đến kho thực tế"
              value={current.arrivedAt ? new Date(current.arrivedAt).toLocaleString('vi-VN') : '—'}
            />
            <InfoValue label="Tạo lúc" value={new Date(current.createdAt).toLocaleString('vi-VN')} />
          </div>
          {current.cancellationReason ? (
            <p className="mt-4 rounded-control border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              <span className="font-semibold">Lý do hủy:</span> {current.cancellationReason}
            </p>
          ) : null}
        </section>

        {isRouteManager ? <LineHaulSchedulePanel onUpdated={updateTrip} trip={current} /> : null}

        <section
          aria-labelledby="route-metrics-title"
          className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface"
        >
          <div>
            <h2 className="text-lg font-semibold text-ink" id="route-metrics-title">
              Khoảng cách và thời gian tuyến
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Kế hoạch được snapshot khi chuyến chuyển READY; dispatch không tính lại lịch sử.
            </p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <RouteMetricCard
              emptyText={
                current.status === 'PLANNED'
                  ? 'Metric sẽ được tính khi Mark Ready.'
                  : 'Kho chưa có đủ tọa độ để snapshot metric.'
              }
              metric={current.plannedRoute}
              title="Kế hoạch kho xuất phát → kho đích"
              timeLabel="Thời gian dự kiến"
            />
            {current.status === 'IN_TRANSIT' ? (
              <RouteMetricCard
                emptyText="Chưa có GPS hiện tại của xe hoặc route metric đang không khả dụng."
                metric={current.remainingRoute}
                title="Từ vị trí xe hiện tại → kho đích"
                timeLabel="ETA dự kiến"
              />
            ) : (
              <div className="rounded-control border border-border bg-surface-subtle p-4">
                <p className="text-sm font-bold text-ink">Tuyến còn lại</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  ETA dự kiến chỉ hiển thị khi chuyến đang chạy, có GPS hiện tại và provider trả
                  duration.
                </p>
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="trip-route-map-title"
          className="mt-6 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink" id="trip-route-map-title">
                Bản đồ tuyến liên kho
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Đường liền là tuyến hiện tại; đường nét đứt giữ tuyến kế hoạch ban đầu sau reroute.
              </p>
            </div>
            {operational?.deviation.state === 'DEVIATED' && isRouteManager ? (
              <Button
                className="w-full lg:w-auto"
                disabled={!current.availableActions.recalculateRoute || rerouteMutation.isPending}
                loading={rerouteMutation.isPending}
                onClick={() => {
                  setSuccess('');
                  setConfirmReroute(true);
                }}
              >
                Tính lại tuyến
              </Button>
            ) : null}
          </div>

          {tripLocation.isPending ? (
            <div className="mt-4">
              <LoadingState label="Đang tải bản đồ tuyến" />
            </div>
          ) : tripLocation.isError ? (
            <div className="mt-4">
              <ErrorState
                compact
                message={getApiErrorMessage(tripLocation.error)}
                onRetry={() => tripLocation.refetch()}
                title="Không thể tải dữ liệu bản đồ"
              />
            </div>
          ) : mapMarkers.length > 0 || routePolylines.length > 0 ? (
            <div className="mt-4">
              <LocationMap
                ariaLabel={`Bản đồ tuyến của chuyến ${current.tripCode}`}
                markers={mapMarkers}
                polylines={routePolylines}
              />
            </div>
          ) : (
            <div className="mt-4 h-72 sm:h-80 lg:h-96">
              <EmptyState
                compact
                description="Không suy đoán tọa độ hoặc vẽ đường thẳng thay cho tuyến đường bộ."
                title="Chưa có vị trí để hiển thị"
              />
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <RouteStateCard operational={operational} />
            <div className="rounded-control border border-border bg-surface-subtle p-4">
              <p className="text-sm font-bold text-ink">Dữ liệu tuyến</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {current.currentRoute?.geometry
                  ? `Đang dùng tuyến v${current.currentRoute.version ?? 1}.`
                  : 'Chưa có dữ liệu tuyến đường'}
              </p>
              {operational?.deviation.state === 'DEVIATED' &&
              isRouteManager &&
              !current.availableActions.recalculateRoute ? (
                <p className="mt-2 text-sm font-semibold leading-6 text-warning">
                  Tính lại tuyến chưa khả dụng vì hệ thống chưa cấu hình route provider đường bộ.
                </p>
              ) : null}
            </div>
          </div>

          {current.routeHistory.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-ink">Lịch sử phiên bản tuyến</h3>
              <ol className="mt-2 grid gap-2 sm:grid-cols-2">
                {current.routeHistory.map((route) => (
                  <li
                    className="rounded-control border border-border bg-surface-muted px-3 py-2 text-sm"
                    key={route.id ?? route.version}
                  >
                    <span className="font-bold text-ink">
                      v{route.version} ·{' '}
                      {route.type === 'REROUTE' ? 'Tuyến tính lại' : 'Tuyến kế hoạch'}
                    </span>
                    <span className="mt-1 block tabular-nums text-muted-foreground">
                      {formatRouteDistance(route.distanceMeters)} ·{' '}
                      {formatRouteDuration(route.durationSeconds)}
                      {route.id === current.currentRoute?.id ? ' · Đang sử dụng' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="trip-actions-title"
          className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink" id="trip-actions-title">
                Trạng thái vận hành
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {current.status === 'PLANNED'
                  ? 'Kiểm tra manifest rồi khóa chuyến trước khi dispatch.'
                  : current.status === 'READY'
                    ? 'Manifest đã khóa; dispatch sẽ chuyển đồng thời trip, xe và toàn bộ kiện.'
                    : current.status === 'IN_TRANSIT'
                      ? 'Chuyến đang chạy và manifest chỉ đọc. Kho đích sẽ xác nhận khi xe đến.'
                      : current.status === 'ARRIVED'
                        ? 'Xe đã đến; từng kiện vẫn phải được kho đích xác nhận tiếp nhận.'
                        : 'Chuyến đã kết thúc và không còn thao tác vận hành.'}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              {current.availableActions.markReady ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={prepareMutation.isPending}
                  loading={prepareMutation.isPending}
                  onClick={() => {
                    setSuccess('');
                    setConfirmPrepare(true);
                  }}
                >
                  Mark Ready
                </Button>
              ) : null}
              {current.availableActions.dispatch ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={dispatchMutation.isPending}
                  loading={dispatchMutation.isPending}
                  onClick={() => {
                    setSuccess('');
                    setConfirmDispatch(true);
                  }}
                >
                  Dispatch chuyến
                </Button>
              ) : null}
              {current.availableActions.arrive ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={arrivalMutation.isPending}
                  loading={arrivalMutation.isPending}
                  onClick={() => {
                    setSuccess('');
                    setConfirmArrival(true);
                  }}
                >
                  Xác nhận xe đến
                </Button>
              ) : null}
            </div>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-success ui-transition"
              style={{ width: `${lineHaulReceiveProgress(current.manifest)}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-semibold tabular-nums text-ink">
            {current.manifest.receivedTransfers}/{current.manifest.totalTransfers} kiện đã nhận
          </p>
        </section>

        <section aria-labelledby="trip-transfer-title" className="mt-6 min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink" id="trip-transfer-title">
              WarehouseTransfer trên chuyến
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Manifest đóng khi READY. Arrival của xe và receive từng kiện là hai xác nhận độc lập.
            </p>
          </div>

          {configurable ? (
            <div className="mb-4 rounded-surface border border-border bg-surface p-4 shadow-surface">
              <div className="grid gap-4 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(16rem,1fr)_auto] lg:items-end">
                <FormField
                  disabled={assignMutation.isPending}
                  helperText="Tìm theo mã transfer hoặc tracking code."
                  id="eligible-transfer-search"
                  label="Tìm transfer đúng tuyến"
                  onChange={(event) => {
                    setTransferSearch(event.target.value);
                    setSelectedTransferId('');
                  }}
                  placeholder="VD: TRF-..."
                  type="search"
                  value={transferSearch}
                />
                <SelectField
                  disabled={
                    eligibleTransfers.isPending ||
                    eligibleTransfers.isError ||
                    assignMutation.isPending
                  }
                  id="eligible-transfer"
                  label="Transfer có thể gán"
                  onChange={(event) => setSelectedTransferId(event.target.value)}
                  value={selectedTransferId}
                >
                  <option value="">
                    {eligibleTransfers.isPending
                      ? 'Đang tải transfer...'
                      : eligibleTransfers.isError
                        ? 'Không thể tải transfer'
                        : eligibleTransfers.data.length
                          ? 'Chọn transfer'
                          : 'Không có transfer phù hợp'}
                  </option>
                  {eligibleTransfers.data?.map((transfer: EligibleWarehouseTransfer) => (
                    <option
                      disabled={!transfer.fitsVehicleCapacity}
                      key={transfer.id}
                      value={transfer.id}
                    >
                      {warehouseTransferLabel(transfer)}
                      {transfer.fitsVehicleCapacity ? '' : ' — Vượt sức tải'}
                    </option>
                  ))}
                </SelectField>
                <Button
                  className="w-full lg:w-auto"
                  disabled={
                    !selectedTransferId ||
                    eligibleTransfers.isError ||
                    selectedTransfer?.fitsVehicleCapacity === false
                  }
                  loading={assignMutation.isPending}
                  onClick={() => {
                    setSuccess('');
                    setConfirmAssign(true);
                  }}
                >
                  Gán vào chuyến
                </Button>
              </div>
              {selectedTransfer ? (
                <p
                  className={`mt-3 rounded-control border px-3 py-2 text-sm font-semibold leading-6 ${
                    selectedTransfer.fitsVehicleCapacity
                      ? 'border-success/30 bg-success-soft text-success'
                      : 'border-danger/30 bg-danger-soft text-danger'
                  }`}
                  role="status"
                >
                  Sau khi gán: {formatCapacityWeight(selectedTransfer.projectedManifestWeightGrams)}{' '}
                  / {formatCapacityWeight(current.manifest.vehicleCapacityWeightGrams)}.{' '}
                  {selectedTransfer.fitsVehicleCapacity
                    ? `Còn ${formatCapacityWeight(selectedTransfer.remainingCapacityAfterAddGrams)}.`
                    : `Vượt ${formatCapacityWeight(Math.abs(selectedTransfer.remainingCapacityAfterAddGrams))}; chọn kiện khác hoặc xe lớn hơn.`}
                </p>
              ) : null}
              {eligibleTransfers.isError ? (
                <div className="mt-4">
                  <ErrorState
                    compact
                    message={getApiErrorMessage(eligibleTransfers.error)}
                    onRetry={() => eligibleTransfers.refetch()}
                    title="Không thể tải transfer đúng tuyến"
                  />
                </div>
              ) : eligibleTransfers.isSuccess && eligibleTransfers.data.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    compact
                    description="Transfer phải PENDING, trùng kho xuất phát/kho đích và chưa thuộc chuyến active khác."
                    title="Không có transfer có thể gán"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <DataTable
            caption="Lịch sử WarehouseTransfer gắn với chuyến"
            columns={transferColumns}
            emptyDescription="Gán một WarehouseTransfer PENDING cùng tuyến trước khi Mark Ready."
            emptyTitle="Chuyến chưa có WarehouseTransfer"
            getRowKey={(assignment) => assignment.id}
            rows={current.transferAssignments}
          />
        </section>

        {current.availableActions.cancel ? (
          <section className="mt-6 rounded-surface border border-red-200 bg-red-50 p-5">
            <h2 className="text-lg font-semibold text-red-950">Hủy kế hoạch chuyến</h2>
            <p className="mt-2 text-sm leading-6 text-red-900">
              Hủy chuyến giải phóng ownership tài xế, xe và các transfer association active; lịch sử
              vẫn được giữ.
            </p>
            <div className="mt-4 max-w-xl">
              <FormField
                disabled={cancelMutation.isPending}
                error={cancelReasonError}
                id="line-haul-cancel-reason"
                label="Lý do hủy"
                onBlur={() => {
                  if (cancelReason.trim().length > 0 && cancelReason.trim().length < 3) {
                    setCancelReasonError('Nhập ít nhất 3 ký tự');
                  }
                }}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  setCancelReasonError('');
                }}
                value={cancelReason}
              />
              <Button
                className="mt-4 w-full sm:w-auto"
                disabled={cancelReason.trim().length < 3}
                onClick={() => {
                  if (cancelReason.trim().length < 3) {
                    setCancelReasonError('Nhập ít nhất 3 ký tự');
                    return;
                  }
                  setSuccess('');
                  setConfirmCancel(true);
                }}
                variant="danger"
              >
                Hủy chuyến
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel="Khóa manifest"
        description={`Hệ thống sẽ kiểm tra lại tài xế, xe, tuyến và ${current.manifest.totalTransfers} transfer trước khi chuyển sang READY.`}
        loading={prepareMutation.isPending}
        onCancel={() => !prepareMutation.isPending && setConfirmPrepare(false)}
        onConfirm={() => prepareMutation.mutate(current.id)}
        open={confirmPrepare}
        title="Mark Ready chuyến liên kho"
      />
      <ConfirmDialog
        confirmLabel="Dispatch chuyến"
        description={`Trip, vehicle và toàn bộ ${current.manifest.totalTransfers} shipment sẽ chuyển trạng thái trong cùng một transaction.`}
        loading={dispatchMutation.isPending}
        onCancel={() => !dispatchMutation.isPending && setConfirmDispatch(false)}
        onConfirm={() => dispatchMutation.mutate(current.id)}
        open={confirmDispatch}
        title="Xác nhận xe rời kho"
      />
      <ConfirmDialog
        confirmLabel="Xác nhận xe đến"
        description="Arrival chỉ xác nhận xe đã tới kho đích và giải phóng vehicle; kiện hàng vẫn phải receive riêng."
        loading={arrivalMutation.isPending}
        onCancel={() => !arrivalMutation.isPending && setConfirmArrival(false)}
        onConfirm={() => arrivalMutation.mutate(current.id)}
        open={confirmArrival}
        title="Xác nhận arrival"
      />
      <ConfirmDialog
        confirmLabel="Nhận kiện"
        description={
          receiveTarget
            ? `${receiveTarget.warehouseTransfer.transferCode} / ${receiveTarget.warehouseTransfer.shipment.trackingCode} sẽ được nhập vào inventory kho đích.`
            : ''
        }
        loading={receiveMutation.isPending}
        onCancel={() => !receiveMutation.isPending && setReceiveTarget(null)}
        onConfirm={() => receiveTarget && receiveMutation.mutate(receiveTarget)}
        open={Boolean(receiveTarget)}
        title="Xác nhận unload / receive"
      />
      <ConfirmDialog
        confirmLabel="Gán transfer"
        description={
          selectedTransfer
            ? `${warehouseTransferLabel(selectedTransfer)} sẽ đưa manifest lên ${formatCapacityWeight(selectedTransfer.projectedManifestWeightGrams)} / ${formatCapacityWeight(current.manifest.vehicleCapacityWeightGrams)}.`
            : ''
        }
        loading={assignMutation.isPending}
        onCancel={() => !assignMutation.isPending && setConfirmAssign(false)}
        onConfirm={() =>
          selectedTransferId &&
          assignMutation.mutate({ tripId: id, transferId: selectedTransferId })
        }
        open={confirmAssign}
        title="Xác nhận gán WarehouseTransfer"
      />
      <ConfirmDialog
        confirmLabel="Gỡ khỏi chuyến"
        description={
          removeTarget
            ? `${removeTarget.warehouseTransfer.transferCode} sẽ được giải phóng nhưng lịch sử association vẫn được giữ.`
            : ''
        }
        loading={removeMutation.isPending}
        onCancel={() => !removeMutation.isPending && setRemoveTarget(null)}
        onConfirm={() =>
          removeTarget &&
          removeMutation.mutate({ tripId: id, transferId: removeTarget.warehouseTransfer.id })
        }
        open={Boolean(removeTarget)}
        title="Xác nhận gỡ WarehouseTransfer"
      />
      <ConfirmDialog
        confirmLabel="Tính lại tuyến"
        description={`Hệ thống sẽ tính từ GPS hiện tại đến ${current.destinationWarehouse.name}, tạo phiên bản mới và giữ nguyên tuyến kế hoạch v1.`}
        loading={rerouteMutation.isPending}
        onCancel={() => !rerouteMutation.isPending && setConfirmReroute(false)}
        onConfirm={() => rerouteMutation.mutate(current.id)}
        open={confirmReroute}
        title="Xác nhận tính lại tuyến"
      />
      <ConfirmDialog
        confirmLabel="Hủy chuyến"
        description={`Chuyến ${current.tripCode} sẽ chuyển sang CANCELLED và chỉ được hủy trước khi dispatch.`}
        destructive
        loading={cancelMutation.isPending}
        onCancel={() => !cancelMutation.isPending && setConfirmCancel(false)}
        onConfirm={() => cancelMutation.mutate({ tripId: id, reason: cancelReason.trim() })}
        open={confirmCancel}
        title="Xác nhận hủy chuyến liên kho"
      />
    </AccountLayout>
  );
}

function InfoCard({
  children,
  label,
  primary,
  secondary,
}: {
  children?: ReactNode;
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <article className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 wrap-anywhere font-semibold leading-6 text-ink">{primary}</p>
      <p className="mt-1 wrap-anywhere text-sm leading-5 text-muted-foreground">{secondary}</p>
      {children}
    </article>
  );
}

function RouteStateCard({ operational }: { operational: LineHaulTripLocation | undefined }) {
  const deviation = operational?.deviation;
  const state = deviation?.state ?? 'UNKNOWN';
  const label =
    state === 'DEVIATED'
      ? 'Lệch tuyến'
      : state === 'ON_ROUTE'
        ? 'Đúng tuyến'
        : 'Chưa xác định trạng thái tuyến';
  const tone =
    state === 'DEVIATED'
      ? 'border-danger/30 bg-danger-soft text-danger'
      : state === 'ON_ROUTE'
        ? 'border-success/30 bg-success-soft text-emerald-900'
        : 'border-border bg-surface-muted text-muted-foreground';
  return (
    <div aria-live="polite" className={`rounded-control border p-4 ${tone}`} role="status">
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-2 text-sm leading-6 tabular-nums">
        {deviation?.distanceFromRouteMeters !== null &&
        deviation?.distanceFromRouteMeters !== undefined
          ? `Cách tuyến ${formatRouteDistance(deviation.distanceFromRouteMeters)}`
          : 'Cần GPS hiện tại và route geometry để xác định.'}
        {deviation?.detectedAt
          ? ` · ${new Date(deviation.detectedAt).toLocaleString('vi-VN')}`
          : ''}
      </p>
    </div>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function RouteMetricCard({
  emptyText,
  metric,
  timeLabel,
  title,
}: {
  emptyText: string;
  metric: RouteMetricView | null;
  timeLabel: string;
  title: string;
}) {
  return (
    <article className="min-w-0 rounded-control border border-border bg-surface-subtle p-4">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {metric ? (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <InfoValue
              label={routeMetricSourceLabel(metric.mode)}
              value={formatRouteDistance(metric.distanceMeters)}
            />
            <InfoValue label={timeLabel} value={formatRouteDuration(metric.durationSeconds)} />
          </dl>
          {metric.mode === 'HAVERSINE_FALLBACK' ? (
            <p className="mt-3 text-xs font-semibold leading-5 text-amber-800">
              Route provider không khả dụng; không có ETA cho khoảng cách ước tính.
            </p>
          ) : null}
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            Tính lúc {new Date(metric.calculatedAt).toLocaleString('vi-VN')}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{emptyText}</p>
      )}
    </article>
  );
}
