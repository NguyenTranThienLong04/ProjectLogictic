import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTable } from '../../components/ui/data-table';
import type { DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { Modal } from '../../components/ui/modal';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { LineHaulVehicleStatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import {
  createLineHaulVehicle,
  listLineHaulVehicles,
  setLineHaulVehicleStatus,
  updateLineHaulVehicleCapacity,
} from './line-haul-api';
import {
  capacityGramsToKilograms,
  capacityKilogramsToGrams,
  formatCapacityWeight,
} from './line-haul-model';
import type { LineHaulVehicle, LineHaulVehicleStatus } from './line-haul-types';

const vehicleSchema = z.object({
  vehicleCode: z
    .string()
    .trim()
    .min(2, 'Tối thiểu 2 ký tự')
    .max(32, 'Tối đa 32 ký tự')
    .regex(/^[A-Za-z0-9_-]+$/, 'Chỉ dùng chữ, số, gạch ngang hoặc gạch dưới'),
  licensePlate: z.string().trim().min(4, 'Tối thiểu 4 ký tự').max(20, 'Tối đa 20 ký tự'),
  vehicleType: z.string().trim().min(2, 'Nhập loại xe').max(50, 'Tối đa 50 ký tự'),
  capacityWeightKg: z
    .string()
    .trim()
    .min(1, 'Nhập sức tải của xe')
    .regex(/^\d+(?:[.,]\d{1,3})?$/, 'Nhập kg dương, tối đa 3 chữ số thập phân')
    .refine((value) => capacityKilogramsToGrams(value) > 0, 'Sức tải phải lớn hơn 0 kg')
    .refine((value) => capacityKilogramsToGrams(value) <= 100_000_000, 'Sức tải tối đa 100.000 kg'),
});
type VehicleForm = z.infer<typeof vehicleSchema>;
type ConfigurableVehicleStatus = Exclude<LineHaulVehicleStatus, 'IN_USE'>;

const statusOptions: Array<{ value: LineHaulVehicleStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'AVAILABLE', label: 'Sẵn sàng' },
  { value: 'IN_USE', label: 'Đang khai thác' },
  { value: 'MAINTENANCE', label: 'Bảo trì' },
  { value: 'INACTIVE', label: 'Ngừng khai thác' },
];

export function AdminLineHaulVehiclesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<LineHaulVehicleStatus | ''>('');
  const [page, setPage] = useState(1);
  const [success, setSuccess] = useState('');
  const [capacityEdit, setCapacityEdit] = useState<LineHaulVehicle | null>(null);
  const [capacityKg, setCapacityKg] = useState('');
  const [capacityError, setCapacityError] = useState('');
  const [statusChange, setStatusChange] = useState<{
    vehicle: LineHaulVehicle;
    status: ConfigurableVehicleStatus;
  } | null>(null);
  const vehicles = useQuery({
    queryKey: ['line-haul-vehicles', deferredSearch, status, page],
    queryFn: () =>
      listLineHaulVehicles({
        search: deferredSearch || undefined,
        status: status || undefined,
        page,
        limit: 20,
      }),
  });
  const { formState, handleSubmit, register, reset } = useForm<VehicleForm>({
    resolver: zodResolver(vehicleSchema),
    mode: 'onBlur',
    defaultValues: {
      vehicleCode: '',
      licensePlate: '',
      vehicleType: '',
      capacityWeightKg: '',
    },
  });
  const createMutation = useMutation({
    mutationFn: (values: VehicleForm) =>
      createLineHaulVehicle({
        vehicleCode: values.vehicleCode,
        licensePlate: values.licensePlate,
        vehicleType: values.vehicleType,
        capacityWeightGrams: capacityKilogramsToGrams(values.capacityWeightKg),
      }),
    onSuccess: async (vehicle) => {
      reset();
      setSuccess(`Đã thêm ${vehicle.vehicleCode} vào đội xe tuyến liên kho.`);
      await queryClient.invalidateQueries({ queryKey: ['line-haul-vehicles'] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: setLineHaulVehicleStatus,
    onSuccess: async (vehicle) => {
      setStatusChange(null);
      setSuccess(`Đã cập nhật ${vehicle.vehicleCode}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['line-haul-vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-vehicles'] }),
      ]);
    },
  });
  const capacityMutation = useMutation({
    mutationFn: updateLineHaulVehicleCapacity,
    onSuccess: async (vehicle) => {
      setCapacityEdit(null);
      setCapacityKg('');
      setCapacityError('');
      setSuccess(`Đã cập nhật sức tải ${vehicle.vehicleCode}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['line-haul-vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-trips'] }),
      ]);
    },
  });

  const openCapacityEdit = (vehicle: LineHaulVehicle) => {
    setSuccess('');
    setCapacityEdit(vehicle);
    setCapacityKg(
      vehicle.capacityWeightGrams === null
        ? ''
        : capacityGramsToKilograms(vehicle.capacityWeightGrams),
    );
    setCapacityError('');
    capacityMutation.reset();
  };

  const validateCapacity = () => {
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(capacityKg.trim())) {
      setCapacityError('Nhập kg dương, tối đa 3 chữ số thập phân');
      return null;
    }
    const grams = capacityKilogramsToGrams(capacityKg.trim());
    if (grams <= 0 || grams > 100_000_000) {
      setCapacityError('Sức tải phải từ 0,001 đến 100.000 kg');
      return null;
    }
    setCapacityError('');
    return grams;
  };

  const askStatusChange = (vehicle: LineHaulVehicle, nextStatus: ConfigurableVehicleStatus) => {
    setSuccess('');
    setStatusChange({ vehicle, status: nextStatus });
  };
  const columns: DataTableColumn<LineHaulVehicle>[] = [
    {
      id: 'vehicle',
      header: 'Xe tuyến',
      render: (vehicle) => (
        <span className="block">
          <span className="block font-mono text-xs font-bold text-primary">
            {vehicle.vehicleCode}
          </span>
          <span className="mt-1 block font-semibold text-ink">{vehicle.licensePlate}</span>
        </span>
      ),
    },
    { id: 'type', header: 'Loại xe', render: (vehicle) => vehicle.vehicleType },
    {
      id: 'capacity',
      header: 'Tải trọng',
      render: (vehicle) => (
        <span className="tabular-nums">{formatCapacityWeight(vehicle.capacityWeightGrams)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Trạng thái',
      render: (vehicle) => <LineHaulVehicleStatusBadge status={vehicle.status} />,
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (vehicle) => {
        const pending =
          statusMutation.isPending && statusMutation.variables.vehicleId === vehicle.id;
        if (vehicle.status === 'IN_USE') {
          return (
            <div className="flex flex-col items-stretch gap-2 md:items-end">
              <Button
                disabled
                title="Không thể đổi sức tải khi xe đang khai thác"
                variant="secondary"
              >
                Sửa sức tải
              </Button>
              <span className="text-sm text-muted-foreground">Do chuyến xe quản lý</span>
            </div>
          );
        }
        if (vehicle.status !== 'AVAILABLE') {
          return (
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button
                disabled={pending}
                onClick={() => openCapacityEdit(vehicle)}
                variant="secondary"
              >
                Sửa sức tải
              </Button>
              <Button
                disabled={pending}
                onClick={() => askStatusChange(vehicle, 'AVAILABLE')}
                variant="secondary"
              >
                Kích hoạt
              </Button>
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-2 md:flex-row md:justify-end">
            <Button
              disabled={pending}
              onClick={() => openCapacityEdit(vehicle)}
              variant="secondary"
            >
              Sửa sức tải
            </Button>
            <Button
              disabled={pending}
              onClick={() => askStatusChange(vehicle, 'MAINTENANCE')}
              variant="secondary"
            >
              Bảo trì
            </Button>
            <Button
              disabled={pending}
              onClick={() => askStatusChange(vehicle, 'INACTIVE')}
              variant="danger"
            >
              Ngừng khai thác
            </Button>
          </div>
        );
      },
    },
  ];

  const dialogLabel =
    statusChange?.status === 'AVAILABLE'
      ? 'Kích hoạt xe'
      : statusChange?.status === 'MAINTENANCE'
        ? 'Chuyển sang bảo trì'
        : 'Ngừng khai thác';

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Quản lý đội xe dùng riêng cho chuyến Warehouse → Warehouse. Xe đã có lịch sử chuyến không bị xóa cứng."
          eyebrow="Quản trị · Fleet foundation"
          meta={
            <span className="rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-muted-foreground">
              {vehicles.isPending
                ? 'Đang tải đội xe'
                : vehicles.isError
                  ? 'Chưa đồng bộ'
                  : `${vehicles.data?.total ?? 0} xe`}
            </span>
          }
          title="Xe tuyến liên kho"
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold text-emerald-900"
          >
            {success}
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
          <section className="rounded-surface border border-border bg-surface p-5 shadow-surface xl:sticky xl:top-6">
            <h2 className="text-lg font-semibold text-ink">Thêm xe tuyến</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Mã xe và biển số được chuẩn hóa chữ hoa, unique trên toàn đội xe.
            </p>
            <form
              className="mt-5 space-y-4"
              noValidate
              onSubmit={handleSubmit((values) => {
                setSuccess('');
                createMutation.mutate(values);
              })}
            >
              <ErrorSummary
                message={
                  createMutation.isError ? getApiErrorMessage(createMutation.error) : undefined
                }
              />
              <FormField
                disabled={createMutation.isPending}
                error={formState.errors.vehicleCode?.message}
                id="line-haul-vehicle-code"
                label="Mã xe"
                placeholder="VD: LH-TRUCK-01"
                {...register('vehicleCode')}
              />
              <FormField
                disabled={createMutation.isPending}
                error={formState.errors.licensePlate?.message}
                id="line-haul-license-plate"
                label="Biển số"
                placeholder="VD: 51C-12345"
                {...register('licensePlate')}
              />
              <FormField
                disabled={createMutation.isPending}
                error={formState.errors.vehicleType?.message}
                id="line-haul-vehicle-type"
                label="Loại xe"
                placeholder="VD: Xe tải thùng 8 tấn"
                {...register('vehicleType')}
              />
              <FormField
                disabled={createMutation.isPending}
                error={formState.errors.capacityWeightKg?.message}
                helperText="Bắt buộc. Hệ thống lưu số gram nguyên; có thể nhập tối đa 3 chữ số thập phân kg."
                id="line-haul-capacity"
                inputMode="decimal"
                label="Sức tải tối đa (kg)"
                placeholder="VD: 8000"
                {...register('capacityWeightKg')}
              />
              <Button className="w-full" loading={createMutation.isPending} type="submit">
                Thêm xe tuyến
              </Button>
            </form>
          </section>

          <section aria-labelledby="line-haul-vehicle-list-title" className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink" id="line-haul-vehicle-list-title">
                Đội xe
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Chỉ xe Sẵn sàng và chưa thuộc chuyến active mới xuất hiện khi Dispatcher lập chuyến.
              </p>
            </div>
            {statusMutation.isError ? (
              <div className="mb-4">
                <ErrorSummary message={getApiErrorMessage(statusMutation.error)} />
              </div>
            ) : null}
            <SearchFilter
              disabled={vehicles.isPending}
              label="Tìm xe tuyến"
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              onClear={() => {
                setSearch('');
                setPage(1);
              }}
              placeholder="Mã xe, biển số hoặc loại xe"
              value={search}
            >
              <label className="block min-w-48 text-sm font-semibold text-ink">
                Trạng thái
                <Select
                  className="mt-1.5"
                  disabled={vehicles.isPending}
                  onChange={(event) => {
                    setStatus(event.target.value as LineHaulVehicleStatus | '');
                    setPage(1);
                  }}
                  value={status}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            </SearchFilter>
            <div className="mt-4">
              <DataTable
                caption="Danh sách xe tuyến liên kho"
                columns={columns}
                emptyDescription="Thêm xe đầu tiên bằng biểu mẫu bên cạnh hoặc đổi bộ lọc."
                emptyTitle="Chưa có xe phù hợp"
                error={vehicles.isError ? getApiErrorMessage(vehicles.error) : undefined}
                getRowKey={(vehicle) => vehicle.id}
                loading={vehicles.isPending}
                loadingLabel="Đang tải đội xe tuyến liên kho"
                onRetry={() => vehicles.refetch()}
                rows={vehicles.data?.items ?? []}
              />
            </div>
            <div className="mt-4">
              <Pagination
                disabled={vehicles.isFetching}
                label="Phân trang xe tuyến liên kho"
                onPageChange={setPage}
                page={vehicles.data?.page ?? page}
                totalPages={vehicles.data?.totalPages ?? 0}
              />
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        confirmLabel={dialogLabel}
        description={
          statusChange
            ? `${statusChange.vehicle.vehicleCode} — ${statusChange.vehicle.licensePlate}. Backend sẽ từ chối nếu xe đang thuộc một chuyến active.`
            : ''
        }
        destructive={statusChange?.status === 'INACTIVE'}
        loading={statusMutation.isPending}
        onCancel={() => !statusMutation.isPending && setStatusChange(null)}
        onConfirm={() => {
          if (statusChange) {
            statusMutation.mutate({
              vehicleId: statusChange.vehicle.id,
              status: statusChange.status,
            });
          }
        }}
        open={Boolean(statusChange)}
        title={dialogLabel}
      />
      <Modal
        description="Backend sẽ chặn xe đang IN_USE và sức tải thấp hơn tải manifest của chuyến active."
        footer={
          <>
            <Button
              disabled={capacityMutation.isPending}
              onClick={() => {
                setCapacityEdit(null);
                setCapacityError('');
              }}
              variant="secondary"
            >
              Hủy
            </Button>
            <Button
              loading={capacityMutation.isPending}
              onClick={() => {
                const grams = validateCapacity();
                if (capacityEdit && grams !== null) {
                  capacityMutation.mutate({
                    vehicleId: capacityEdit.id,
                    capacityWeightGrams: grams,
                  });
                }
              }}
            >
              Lưu sức tải
            </Button>
          </>
        }
        onClose={() => !capacityMutation.isPending && setCapacityEdit(null)}
        open={Boolean(capacityEdit)}
        size="sm"
        title={capacityEdit ? `Sửa sức tải ${capacityEdit.vehicleCode}` : 'Sửa sức tải xe'}
      >
        {capacityMutation.isError ? (
          <div className="mb-4">
            <ErrorSummary message={getApiErrorMessage(capacityMutation.error)} />
          </div>
        ) : null}
        <FormField
          autoFocus
          disabled={capacityMutation.isPending}
          error={capacityError}
          helperText="Ví dụ 1000 kg. Giá trị được chuyển chính xác sang integer grams khi gửi API."
          id="edit-line-haul-capacity"
          inputMode="decimal"
          label="Sức tải tối đa (kg)"
          onBlur={validateCapacity}
          onChange={(event) => {
            setCapacityKg(event.target.value);
            setCapacityError('');
          }}
          value={capacityKg}
        />
      </Modal>
    </AccountLayout>
  );
}
