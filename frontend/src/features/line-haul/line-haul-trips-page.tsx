import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
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
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { SelectField } from '../../components/ui/select-field';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { useAuth } from '../auth/auth-context';
import { AccountLayout } from '../auth/components/account-layout';
import { listWarehouses } from '../warehouses/warehouses-api';
import { CapacityIndicator } from './capacity-indicator';
import {
  createLineHaulTrip,
  listEligibleLineHaulDrivers,
  listEligibleLineHaulVehicles,
  listLineHaulTrips,
} from './line-haul-api';
import {
  lineHaulDriverLabel,
  lineHaulVehicleLabel,
  lineHaulWarehouseLabel,
} from './line-haul-model';
import { LineHaulScheduleBoard } from './line-haul-schedule-board';
import { LineHaulPlanningPanel } from './line-haul-planning-panel';
import type {
  LineHaulPlanningRecommendation,
  LineHaulTrip,
  LineHaulTripStatus,
  LineHaulWarehouse,
} from './line-haul-types';

const tripSchema = z
  .object({
    originWarehouseId: z.uuid('Chọn kho xuất phát'),
    destinationWarehouseId: z.uuid('Chọn kho đích'),
    driverId: z.uuid('Chọn tài xế line-haul'),
    vehicleId: z.uuid('Chọn xe sẵn sàng'),
  })
  .superRefine((values, context) => {
    if (values.originWarehouseId === values.destinationWarehouseId) {
      context.addIssue({
        code: 'custom',
        path: ['destinationWarehouseId'],
        message: 'Kho đích phải khác kho xuất phát',
      });
    }
  });
type TripForm = z.infer<typeof tripSchema>;

const tripStatusOptions: Array<{ value: LineHaulTripStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'PLANNED', label: 'Đã lập kế hoạch' },
  { value: 'READY', label: 'Sẵn sàng xuất phát' },
  { value: 'IN_TRANSIT', label: 'Đang chạy tuyến' },
  { value: 'ARRIVED', label: 'Đã đến kho đích' },
  { value: 'CANCELLED', label: 'Đã hủy' },
];

export function LineHaulTripsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<LineHaulTripStatus | ''>('');
  const [page, setPage] = useState(1);
  const [driverSearch, setDriverSearch] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const deferredDriverSearch = useDeferredValue(driverSearch);
  const deferredVehicleSearch = useDeferredValue(vehicleSearch);
  const [pendingForm, setPendingForm] = useState<TripForm | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<LineHaulPlanningRecommendation | null>(null);
  const [success, setSuccess] = useState('');
  const detailBase = user?.role === 'ADMIN' ? '/admin/line-haul/trips' : '/dispatcher/line-haul';
  const trips = useQuery({
    queryKey: ['line-haul-trips', deferredSearch, status, page],
    queryFn: () =>
      listLineHaulTrips({
        search: deferredSearch || undefined,
        status: status || undefined,
        page,
        limit: 20,
      }),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses', 'line-haul-active'],
    queryFn: () => listWarehouses<LineHaulWarehouse>({ isActive: true, limit: 100 }),
  });
  const drivers = useQuery({
    queryKey: ['line-haul-eligible-drivers', deferredDriverSearch],
    queryFn: () => listEligibleLineHaulDrivers(deferredDriverSearch || undefined),
  });
  const vehicles = useQuery({
    queryKey: ['line-haul-eligible-vehicles', deferredVehicleSearch],
    queryFn: () => listEligibleLineHaulVehicles(deferredVehicleSearch || undefined),
  });
  const { control, formState, handleSubmit, reset, setValue } = useForm<TripForm>({
    resolver: zodResolver(tripSchema),
    mode: 'onBlur',
    defaultValues: {
      originWarehouseId: '',
      destinationWarehouseId: '',
      driverId: '',
      vehicleId: '',
    },
  });
  const selectedOriginId = useWatch({ control, name: 'originWarehouseId' });
  const selectedVehicleId = useWatch({ control, name: 'vehicleId' });
  const createMutation = useMutation({
    mutationFn: (values: TripForm) =>
      createLineHaulTrip({
        originWarehouseId: values.originWarehouseId,
        destinationWarehouseId: values.destinationWarehouseId,
        driverId: values.driverId,
        vehicleId: values.vehicleId,
        ...(selectedRecommendation
          ? {
              scheduledStartAt: selectedRecommendation.scheduledStartAt,
              scheduledEndAt: selectedRecommendation.scheduledEndAt,
              warehouseTransferIds: selectedRecommendation.transfers.map(({ id }) => id),
            }
          : {}),
      }),
    onSuccess: async (trip) => {
      setPendingForm(null);
      reset();
      setDriverSearch('');
      setVehicleSearch('');
      setSelectedRecommendation(null);
      setSuccess(`Đã lập chuyến ${trip.tripCode}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['line-haul-trips'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-vehicles'] }),
      ]);
      navigate(`${detailBase}/${trip.id}`);
    },
  });

  const resourcesPending = warehouses.isPending || drivers.isPending || vehicles.isPending;
  const resourcesError = warehouses.isError || drivers.isError || vehicles.isError;
  const resourcesEmpty =
    warehouses.isSuccess &&
    drivers.isSuccess &&
    vehicles.isSuccess &&
    (warehouses.data.items.length < 2 || drivers.data.length === 0 || vehicles.data.length === 0);
  const formDisabled =
    resourcesPending || resourcesError || resourcesEmpty || createMutation.isPending;
  const destinationWarehouses =
    warehouses.data?.items.filter((warehouse) => warehouse.id !== selectedOriginId) ?? [];
  const selectedVehicle = vehicles.data?.find((vehicle) => vehicle.id === selectedVehicleId);
  const applyRecommendation = (recommendation: LineHaulPlanningRecommendation) => {
    setSelectedRecommendation(recommendation);
    setDriverSearch('');
    setVehicleSearch('');
    setValue('originWarehouseId', recommendation.originWarehouseId, { shouldValidate: true });
    setValue('destinationWarehouseId', recommendation.destinationWarehouseId, {
      shouldValidate: true,
    });
    setValue('driverId', recommendation.driver.id, { shouldValidate: true });
    setValue('vehicleId', recommendation.vehicle.id, { shouldValidate: true });
    window.requestAnimationFrame(() => {
      document.getElementById('line-haul-create-form')?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
    });
  };
  const columns: DataTableColumn<LineHaulTrip>[] = [
    {
      id: 'trip',
      header: 'Chuyến',
      render: (trip) => (
        <Link
          className="focus-ring rounded-control font-mono text-xs font-bold text-primary hover:underline"
          to={`${detailBase}/${trip.id}`}
        >
          {trip.tripCode}
        </Link>
      ),
    },
    {
      id: 'route',
      header: 'Tuyến kho',
      render: (trip) => (
        <span className="block">
          <span className="block font-semibold text-ink">{trip.originWarehouse.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            đến {trip.destinationWarehouse.name}
          </span>
        </span>
      ),
    },
    {
      id: 'resources',
      header: 'Tài xế / xe',
      render: (trip) => (
        <span className="block">
          <span className="block font-medium text-ink">{lineHaulDriverLabel(trip.driver)}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {lineHaulVehicleLabel(trip.vehicle)}
          </span>
        </span>
      ),
    },
    {
      id: 'departure',
      header: 'Window đã đặt',
      render: (trip) => (
        <span className="block text-xs leading-5 tabular-nums">
          {trip.scheduledStartAt && trip.scheduledEndAt ? (
            <>
              <span className="block font-semibold text-ink">
                {new Date(trip.scheduledStartAt).toLocaleString('vi-VN')}
              </span>
              <span className="block text-muted-foreground">
                đến {new Date(trip.scheduledEndAt).toLocaleString('vi-VN')}
              </span>
            </>
          ) : (
            'Chưa lên lịch'
          )}
        </span>
      ),
    },
    {
      id: 'transfers',
      header: 'Transfer',
      align: 'center',
      render: (trip) => (
        <span className="font-semibold tabular-nums">
          {trip.transferAssignments.filter((assignment) => assignment.isActive).length}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (trip) => <LineHaulTripStatusBadge status={trip.status} />,
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          description="Lập trip trước, sau đó dùng command schedule trên chi tiết để giữ tài xế và xe theo window."
          eyebrow="Điều phối · Line-haul scheduling"
          meta={
            <span className="rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-muted-foreground">
              {trips.isPending
                ? 'Đang tải chuyến'
                : trips.isError
                  ? 'Chưa đồng bộ'
                  : `${trips.data?.total ?? 0} chuyến`}
            </span>
          }
          title="Chuyến xe liên kho"
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold text-emerald-900"
          >
            {success}
          </p>
        ) : null}

        <LineHaulPlanningPanel
          onSelect={applyRecommendation}
          selectedRecommendation={selectedRecommendation}
        />

        <div className="mt-6 grid gap-6 2xl:grid-cols-[24rem_minmax(0,1fr)] 2xl:items-start">
          <section
            className="scroll-mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface 2xl:sticky 2xl:top-6"
            id="line-haul-create-form"
          >
            <h2 className="text-lg font-semibold text-ink">Lập chuyến mới</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Backend chỉ nhận kho active, tài xế có LINE_HAUL và xe AVAILABLE có sức tải hợp lệ. Đề
              xuất được chọn sẽ điền thêm window và manifest; backend vẫn khóa và kiểm tra lại toàn
              bộ trước khi commit.
            </p>
            {selectedRecommendation ? (
              <div
                aria-live="polite"
                className="mt-4 rounded-control border border-blue-200 bg-primary-soft p-3 text-sm leading-6 text-primary-strong"
              >
                <p className="font-semibold">
                  Đang dùng đề xuất hạng {selectedRecommendation.rank} ·{' '}
                  {selectedRecommendation.score}/100
                </p>
                <p className="mt-1 tabular-nums">
                  {new Date(selectedRecommendation.scheduledStartAt).toLocaleString('vi-VN')} đến{' '}
                  {new Date(selectedRecommendation.scheduledEndAt).toLocaleString('vi-VN')} ·{' '}
                  {selectedRecommendation.transfers.length} transfer
                </p>
                <Button
                  className="mt-2"
                  onClick={() => setSelectedRecommendation(null)}
                  size="sm"
                  variant="ghost"
                >
                  Bỏ đề xuất
                </Button>
              </div>
            ) : null}
            <form
              className="mt-5 space-y-4"
              noValidate
              onSubmit={handleSubmit((values) => {
                setSuccess('');
                setPendingForm(values);
              })}
            >
              <ErrorSummary
                message={
                  createMutation.isError ? getApiErrorMessage(createMutation.error) : undefined
                }
              />
              <Controller
                control={control}
                name="originWarehouseId"
                render={({ field }) => (
                  <SelectField
                    disabled={formDisabled}
                    error={formState.errors.originWarehouseId?.message}
                    helperText="Warehouse xuất phát của toàn bộ transfer trên chuyến."
                    id="line-haul-origin"
                    label="Kho xuất phát"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      setSelectedRecommendation(null);
                    }}
                  >
                    <option value="">Chọn kho xuất phát</option>
                    {warehouses.data?.items.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {lineHaulWarehouseLabel(warehouse)}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              {selectedVehicle ? (
                <CapacityIndicator
                  capacityUtilizationPercent={0}
                  compact
                  manifestWeightGrams={0}
                  remainingCapacityWeightGrams={selectedVehicle.capacityWeightGrams}
                  vehicleCapacityWeightGrams={selectedVehicle.capacityWeightGrams}
                />
              ) : null}
              <Controller
                control={control}
                name="destinationWarehouseId"
                render={({ field }) => (
                  <SelectField
                    disabled={formDisabled || !selectedOriginId}
                    error={formState.errors.destinationWarehouseId?.message}
                    helperText="Kho đích phải khác kho xuất phát."
                    id="line-haul-destination"
                    label="Kho đích"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      setSelectedRecommendation(null);
                    }}
                  >
                    <option value="">
                      {selectedOriginId ? 'Chọn kho đích' : 'Chọn kho xuất phát trước'}
                    </option>
                    {destinationWarehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {lineHaulWarehouseLabel(warehouse)}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              <FormField
                autoComplete="off"
                disabled={formDisabled}
                helperText="Tìm theo họ tên hoặc mã nhân viên."
                id="line-haul-driver-search"
                label="Tìm tài xế"
                onChange={(event) => {
                  setDriverSearch(event.target.value);
                  setValue('driverId', '', { shouldValidate: false });
                  setSelectedRecommendation(null);
                }}
                placeholder="VD: DRV-001"
                type="search"
                value={driverSearch}
              />
              <Controller
                control={control}
                name="driverId"
                render={({ field }) => (
                  <SelectField
                    disabled={formDisabled}
                    error={formState.errors.driverId?.message}
                    id="line-haul-driver"
                    label="Tài xế line-haul"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      setSelectedRecommendation(null);
                    }}
                  >
                    <option value="">
                      {drivers.isPending
                        ? 'Đang tải tài xế...'
                        : drivers.data?.length
                          ? 'Chọn tài xế'
                          : 'Không có tài xế phù hợp'}
                    </option>
                    {drivers.data?.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {lineHaulDriverLabel(driver)}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              <FormField
                autoComplete="off"
                disabled={formDisabled}
                helperText="Tìm theo mã xe hoặc biển số."
                id="line-haul-vehicle-search"
                label="Tìm xe"
                onChange={(event) => {
                  setVehicleSearch(event.target.value);
                  setValue('vehicleId', '', { shouldValidate: false });
                  setSelectedRecommendation(null);
                }}
                placeholder="VD: LH-TRUCK-01"
                type="search"
                value={vehicleSearch}
              />
              <Controller
                control={control}
                name="vehicleId"
                render={({ field }) => (
                  <SelectField
                    disabled={formDisabled}
                    error={formState.errors.vehicleId?.message}
                    id="line-haul-vehicle"
                    label="Xe tuyến"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      setSelectedRecommendation(null);
                    }}
                  >
                    <option value="">
                      {vehicles.isPending
                        ? 'Đang tải xe...'
                        : vehicles.data?.length
                          ? 'Chọn xe tuyến'
                          : 'Không có xe phù hợp'}
                    </option>
                    {vehicles.data?.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {lineHaulVehicleLabel(vehicle)}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              {resourcesPending ? (
                <LoadingState compact label="Đang tải kho, tài xế và xe đủ điều kiện" />
              ) : resourcesError ? (
                <ErrorState
                  compact
                  message="Không thể tải đủ dữ liệu lập chuyến."
                  onRetry={() => {
                    warehouses.refetch();
                    drivers.refetch();
                    vehicles.refetch();
                  }}
                  title="Dữ liệu lập chuyến chưa sẵn sàng"
                />
              ) : resourcesEmpty ? (
                <EmptyState
                  compact
                  description="Cần ít nhất hai kho active, một tài xế LINE_HAUL và một xe AVAILABLE có sức tải hợp lệ."
                  title="Chưa đủ nguồn lực lập chuyến"
                />
              ) : null}
              <Button className="w-full" disabled={formDisabled} type="submit">
                {selectedRecommendation ? 'Review và lập chuyến đề xuất' : 'Kiểm tra và lập chuyến'}
              </Button>
            </form>
          </section>

          <section aria-labelledby="line-haul-trip-list-title" className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink" id="line-haul-trip-list-title">
                Danh sách chuyến
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tải manifest và sức tải xe do backend tính bằng integer grams; phần trăm chỉ để hiển
                thị.
              </p>
            </div>
            <SearchFilter
              disabled={trips.isPending}
              label="Tìm chuyến"
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              onClear={() => {
                setSearch('');
                setPage(1);
              }}
              placeholder="Mã chuyến, tài xế, mã xe hoặc biển số"
              value={search}
            >
              <label className="block min-w-52 text-sm font-semibold text-ink">
                Trạng thái chuyến
                <Select
                  className="mt-1.5"
                  disabled={trips.isPending}
                  onChange={(event) => {
                    setStatus(event.target.value as LineHaulTripStatus | '');
                    setPage(1);
                  }}
                  value={status}
                >
                  {tripStatusOptions.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            </SearchFilter>
            <div className="mt-4">
              <DataTable
                caption="Danh sách chuyến xe liên kho"
                columns={columns}
                emptyDescription="Lập chuyến đầu tiên bằng biểu mẫu bên cạnh hoặc đổi bộ lọc."
                emptyTitle="Chưa có chuyến phù hợp"
                error={trips.isError ? getApiErrorMessage(trips.error) : undefined}
                getRowKey={(trip) => trip.id}
                loading={trips.isPending}
                loadingLabel="Đang tải chuyến xe liên kho"
                onRetry={() => trips.refetch()}
                rows={trips.data?.items ?? []}
              />
            </div>
            <div className="mt-4">
              <Pagination
                disabled={trips.isFetching}
                label="Phân trang chuyến xe liên kho"
                onPageChange={setPage}
                page={trips.data?.page ?? page}
                totalPages={trips.data?.totalPages ?? 0}
              />
            </div>
          </section>
        </div>
        <LineHaulScheduleBoard />
      </div>

      <ConfirmDialog
        confirmLabel="Lập chuyến"
        description={
          pendingForm
            ? selectedRecommendation
              ? `Backend sẽ kiểm tra lại window, tài xế, xe, sức tải và ${selectedRecommendation.transfers.length} transfer trước khi tạo trip PLANNED. Không có dispatch tự động.`
              : 'Trip sẽ được tạo ở trạng thái PLANNED nhưng chưa giữ tài xế/xe theo thời gian. Hãy lên lịch tại trang chi tiết.'
            : ''
        }
        loading={createMutation.isPending}
        onCancel={() => !createMutation.isPending && setPendingForm(null)}
        onConfirm={() => pendingForm && createMutation.mutate(pendingForm)}
        open={Boolean(pendingForm)}
        title="Xác nhận lập chuyến liên kho"
      />
    </AccountLayout>
  );
}
