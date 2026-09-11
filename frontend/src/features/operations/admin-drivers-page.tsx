import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
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
import { SelectField } from '../../components/ui/select-field';
import { getApiErrorMessage } from '../../services/api-error';
import type { User } from '../../types/auth';
import { listUsers } from '../admin/admin-api';
import { AccountLayout } from '../auth/components/account-layout';
import { listWarehouses } from '../warehouses/warehouses-api';
import {
  createDriverProfile,
  listDrivers,
  setDriverCapabilities,
  setDriverOperatingWarehouse,
  setDriverSuspended,
} from './operations-api';
import {
  driverAccountLabel,
  filterDriverAccounts,
  getEligibleDriverAccounts,
} from './driver-profile-candidates';
import type {
  DriverCapability,
  DriverProfile,
  DriverStatus,
  Paginated,
} from './operations-types';

const schema = z.object({
  userId: z.uuid('Chọn tài khoản DRIVER'),
  operatingWarehouseId: z.uuid('Chọn kho vận hành'),
  employeeCode: z
    .string()
    .trim()
    .min(2, 'Tối thiểu 2 ký tự')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Chỉ dùng chữ, số, gạch ngang hoặc gạch dưới'),
  vehicleType: z.string().trim().min(2, 'Nhập loại phương tiện').max(50),
  vehiclePlate: z.string().trim().min(4, 'Nhập biển số').max(20),
});
type DriverForm = z.infer<typeof schema>;

async function collectPages<T>(loadPage: (page: number) => Promise<Paginated<T>>): Promise<T[]> {
  const firstPage = await loadPage(1);
  if (firstPage.totalPages <= 1) return firstPage.items;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, (_, index) => loadPage(index + 2)),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}

async function listDriverProfileCandidates(): Promise<User[]> {
  const [users, profiles] = await Promise.all([
    collectPages((page) => listUsers({ role: 'DRIVER', status: 'ACTIVE', page, limit: 50 })),
    collectPages((page) => listDrivers({ page, limit: 50 })),
  ]);

  return getEligibleDriverAccounts(users, profiles);
}

const driverStatusPresentation: Record<DriverStatus, { dot: string; label: string; text: string }> =
  {
    AVAILABLE: { dot: 'bg-success', label: 'Sẵn sàng', text: 'text-success' },
    BUSY: { dot: 'bg-warning', label: 'Đang bận', text: 'text-warning' },
    OFFLINE: { dot: 'bg-slate-400', label: 'Ngoại tuyến', text: 'text-muted-foreground' },
    SUSPENDED: { dot: 'bg-danger', label: 'Đình chỉ', text: 'text-danger' },
  };

const capabilityPresentation: Record<DriverCapability, { className: string; label: string }> = {
  PICKUP: { className: 'border-sky-200 bg-sky-50 text-sky-800', label: 'Lấy hàng' },
  DELIVERY: { className: 'border-violet-200 bg-violet-50 text-violet-800', label: 'Giao hàng' },
  LINE_HAUL: { className: 'border-amber-200 bg-amber-50 text-amber-900', label: 'Tuyến liên kho' },
};

function DriverStatusLabel({ status }: { status: DriverStatus }) {
  const presentation = driverStatusPresentation[status];
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${presentation.text}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${presentation.dot}`} />
      {presentation.label}
    </span>
  );
}

export function AdminDriversPage() {
  const queryClient = useQueryClient();
  const [accountSearch, setAccountSearch] = useState('');
  const [success, setSuccess] = useState('');
  const [capabilityChange, setCapabilityChange] = useState<{
    driver: DriverProfile;
    enable: boolean;
  } | null>(null);
  const [suspensionChange, setSuspensionChange] = useState<{
    driver: DriverProfile;
    suspended: boolean;
  } | null>(null);
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: () => listDrivers() });
  const driverAccounts = useQuery({
    queryKey: ['driver-profile-candidates'],
    queryFn: listDriverProfileCandidates,
  });
  const warehouses = useQuery({
    queryKey: ['warehouses', 'active-driver-operating-areas'],
    queryFn: () => listWarehouses({ isActive: true, limit: 100 }),
  });
  const { control, formState, handleSubmit, register, reset, setValue } = useForm<DriverForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      userId: '',
      operatingWarehouseId: '',
      employeeCode: '',
      vehicleType: '',
      vehiclePlate: '',
    },
  });
  const createMutation = useMutation({
    mutationFn: createDriverProfile,
    onSuccess: async () => {
      reset();
      setAccountSearch('');
      setSuccess('Đã tạo hồ sơ tài xế. Tài xế có thể đăng nhập và bật trạng thái nhận việc.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-profile-candidates'] }),
      ]);
    },
  });
  const statusMutation = useMutation({
    mutationFn: setDriverSuspended,
    onSuccess: async (driver) => {
      setSuspensionChange(null);
      setSuccess(
        driver.status === 'SUSPENDED'
          ? `Đã đình chỉ ${driver.fullName}.`
          : `Đã khôi phục ${driver.fullName} về trạng thái offline.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
  const capabilityMutation = useMutation({
    mutationFn: setDriverCapabilities,
    onSuccess: async (driver) => {
      setCapabilityChange(null);
      setSuccess(
        driver.capabilities.includes('LINE_HAUL')
          ? `Đã bật năng lực tuyến liên kho cho ${driver.fullName}.`
          : `Đã gỡ năng lực tuyến liên kho của ${driver.fullName}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['line-haul-eligible-drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['assignment-candidates'] }),
      ]);
    },
  });
  const warehouseMutation = useMutation({
    mutationFn: setDriverOperatingWarehouse,
    onSuccess: async (driver) => {
      setSuccess(`Đã cập nhật kho vận hành cho ${driver.fullName}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['assignment-candidates'] }),
      ]);
    },
  });

  const candidateAccounts = driverAccounts.data ?? [];
  const filteredAccounts = filterDriverAccounts(candidateAccounts, accountSearch);
  const profileFormDisabled =
    createMutation.isPending ||
    driverAccounts.isPending ||
    driverAccounts.isError ||
    candidateAccounts.length === 0 ||
    warehouses.isPending ||
    warehouses.isError ||
    !warehouses.data?.items.length;
  const rows = drivers.data?.items ?? [];
  const columns: DataTableColumn<DriverProfile>[] = [
    {
      id: 'driver',
      header: 'Tài xế',
      render: (driver) => (
        <span className="block">
          <span className="block font-semibold text-ink">{driver.fullName}</span>
          <span className="mt-0.5 block wrap-anywhere text-xs text-muted-foreground">
            {driver.email}
          </span>
        </span>
      ),
    },
    {
      id: 'employeeCode',
      header: 'Mã nhân viên',
      render: (driver) => (
        <span className="font-mono text-xs font-semibold text-primary">{driver.employeeCode}</span>
      ),
    },
    {
      id: 'vehicle',
      header: 'Phương tiện last-mile',
      render: (driver) => (
        <span className="block">
          <span className="block font-medium text-ink">{driver.vehicleType}</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
            {driver.vehiclePlate}
          </span>
        </span>
      ),
    },
    {
      id: 'capabilities',
      header: 'Năng lực vận hành',
      render: (driver) => {
        const hasLineHaul = driver.capabilities.includes('LINE_HAUL');
        const pending =
          capabilityMutation.isPending && capabilityMutation.variables.driverId === driver.id;
        return (
          <div className="min-w-48">
            <div className="flex flex-wrap gap-1.5">
              {driver.capabilities.map((capability) => {
                const presentation = capabilityPresentation[capability];
                return (
                  <span
                    className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${presentation.className}`}
                    key={capability}
                  >
                    {presentation.label}
                  </span>
                );
              })}
            </div>
            <Button
              className="mt-2 w-full md:w-auto"
              loading={pending}
              onClick={() => {
                setSuccess('');
                setCapabilityChange({ driver, enable: !hasLineHaul });
              }}
              variant={hasLineHaul ? 'secondary' : 'primary'}
            >
              {hasLineHaul ? 'Gỡ tuyến liên kho' : 'Bật tuyến liên kho'}
            </Button>
          </div>
        );
      },
    },
    {
      id: 'operatingWarehouse',
      header: 'Kho vận hành / service area',
      render: (driver) => {
        const busy =
          warehouseMutation.isPending && warehouseMutation.variables.driverId === driver.id;
        return (
          <select
            aria-label={`Kho vận hành của ${driver.fullName}`}
            className="focus-ring min-h-11 w-full min-w-48 rounded-control border border-border bg-surface px-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-surface-muted"
            disabled={
              driver.status === 'BUSY' || busy || warehouses.isPending || warehouses.isError
            }
            onChange={(event) =>
              warehouseMutation.mutate({
                driverId: driver.id,
                operatingWarehouseId: event.target.value,
              })
            }
            value={driver.operatingWarehouse?.id ?? ''}
          >
            <option disabled value="">
              Chưa cấu hình
            </option>
            {warehouses.data?.items.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.city}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      id: 'status',
      header: 'Khả dụng',
      render: (driver) => <DriverStatusLabel status={driver.status} />,
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (driver) => {
        const suspended = driver.status === 'SUSPENDED';
        const busy = statusMutation.isPending && statusMutation.variables.driverId === driver.id;
        return (
          <Button
            className="w-full md:w-auto"
            disabled={driver.status === 'BUSY'}
            loading={busy}
            onClick={() => {
              setSuccess('');
              setSuspensionChange({ driver, suspended: !suspended });
            }}
            variant={suspended ? 'secondary' : 'danger'}
          >
            {suspended ? 'Khôi phục' : 'Đình chỉ'}
          </Button>
        );
      },
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Liên kết tài khoản DRIVER với hồ sơ vận hành, phương tiện và trạng thái khả dụng."
          eyebrow="Quản trị · Nhân sự vận hành"
          meta={
            <span className="rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-muted-foreground">
              {drivers.isPending
                ? 'Đang tải hồ sơ'
                : drivers.isError
                  ? 'Chưa đồng bộ'
                  : `${drivers.data?.total ?? 0} hồ sơ`}
            </span>
          }
          title="Quản lý tài xế"
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900"
          >
            {success}
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
          <section className="rounded-surface border border-border bg-surface p-5 shadow-surface lg:max-w-xl xl:sticky xl:top-6 xl:max-w-none">
            <h2 className="text-lg font-semibold text-ink">Tạo hồ sơ tài xế</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Chọn tài khoản DRIVER đang hoạt động và chưa được liên kết hồ sơ vận hành.
            </p>
            <form
              className="mt-5 space-y-4"
              noValidate
              onSubmit={handleSubmit((values) => createMutation.mutate(values))}
            >
              <ErrorSummary
                message={
                  createMutation.isError ? getApiErrorMessage(createMutation.error) : undefined
                }
              />
              <FormField
                autoComplete="off"
                disabled={profileFormDisabled}
                helperText={
                  driverAccounts.isSuccess && candidateAccounts.length > 0
                    ? `${candidateAccounts.length} tài khoản có thể liên kết.`
                    : 'Tìm theo họ tên hoặc email.'
                }
                id="driver-account-search"
                label="Tìm tài khoản DRIVER"
                onChange={(event) => {
                  setAccountSearch(event.target.value);
                  setValue('userId', '', { shouldValidate: false });
                }}
                placeholder="Ví dụ: driver@test.com"
                type="search"
                value={accountSearch}
              />
              <Controller
                control={control}
                name="userId"
                render={({ field }) => (
                  <SelectField
                    disabled={profileFormDisabled}
                    error={formState.errors.userId?.message}
                    helperText="Danh sách chỉ gồm tài khoản DRIVER active chưa có DriverProfile."
                    id="driver-user-id"
                    label="Tài khoản DRIVER"
                    {...field}
                  >
                    <option value="">
                      {driverAccounts.isPending
                        ? 'Đang tải tài khoản...'
                        : driverAccounts.isError
                          ? 'Không thể tải tài khoản'
                          : candidateAccounts.length === 0
                            ? 'Chưa có tài khoản phù hợp'
                            : filteredAccounts.length === 0
                              ? 'Không tìm thấy kết quả'
                              : 'Chọn tài khoản'}
                    </option>
                    {filteredAccounts.map((user) => (
                      <option key={user.id} value={user.id}>
                        {driverAccountLabel(user)}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              <Controller
                control={control}
                name="operatingWarehouseId"
                render={({ field }) => (
                  <SelectField
                    disabled={profileFormDisabled}
                    error={formState.errors.operatingWarehouseId?.message}
                    helperText="Pickup dùng service area theo city; delivery phải khớp đúng kho đích."
                    id="driver-operating-warehouse"
                    label="Kho vận hành"
                    {...field}
                  >
                    <option value="">
                      {warehouses.isPending
                        ? 'Đang tải kho...'
                        : warehouses.isError
                          ? 'Không thể tải kho'
                          : warehouses.data?.items.length
                            ? 'Chọn kho vận hành'
                            : 'Chưa có kho active'}
                    </option>
                    {warehouses.data?.items.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} · {warehouse.name} · {warehouse.city}
                      </option>
                    ))}
                  </SelectField>
                )}
              />
              {driverAccounts.isPending ? (
                <LoadingState compact label="Đang tải tài khoản DRIVER có thể liên kết" />
              ) : driverAccounts.isError ? (
                <ErrorState
                  compact
                  message={getApiErrorMessage(driverAccounts.error)}
                  onRetry={() => driverAccounts.refetch()}
                  title="Không thể tải tài khoản DRIVER"
                />
              ) : candidateAccounts.length === 0 ? (
                <EmptyState
                  action={
                    <Link
                      className="focus-ring rounded-control border border-border-strong bg-surface px-4 py-3 text-sm font-semibold text-primary hover:border-primary hover:bg-primary-soft"
                      to="/admin/staff/new"
                    >
                      Tạo tài khoản DRIVER
                    </Link>
                  }
                  compact
                  description="Tạo một tài khoản DRIVER active trước, hoặc kiểm tra các tài khoản đã được liên kết."
                  title="Không có tài khoản để liên kết"
                />
              ) : null}
              {warehouses.isPending ? (
                <LoadingState compact label="Đang tải kho vận hành active" />
              ) : warehouses.isError ? (
                <ErrorState
                  compact
                  message={getApiErrorMessage(warehouses.error)}
                  onRetry={() => warehouses.refetch()}
                  title="Không thể tải kho vận hành"
                />
              ) : warehouses.data.items.length === 0 ? (
                <EmptyState
                  compact
                  description="Tạo hoặc kích hoạt một warehouse trước khi tạo DriverProfile."
                  title="Chưa có kho vận hành active"
                />
              ) : null}
              <FormField
                disabled={profileFormDisabled}
                error={formState.errors.employeeCode?.message}
                id="driver-employee-code"
                label="Mã nhân viên"
                {...register('employeeCode')}
              />
              <FormField
                disabled={profileFormDisabled}
                error={formState.errors.vehicleType?.message}
                id="driver-vehicle-type"
                label="Loại phương tiện"
                {...register('vehicleType')}
              />
              <FormField
                disabled={profileFormDisabled}
                error={formState.errors.vehiclePlate?.message}
                id="driver-vehicle-plate"
                label="Biển số"
                {...register('vehiclePlate')}
              />
              <Button
                className="w-full"
                disabled={profileFormDisabled}
                loading={createMutation.isPending}
                type="submit"
              >
                Tạo hồ sơ
              </Button>
            </form>
          </section>

          <section aria-labelledby="driver-list-title" className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink" id="driver-list-title">
                Đội tài xế
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Trạng thái khả dụng và phương tiện đang liên kết với từng tài khoản.
              </p>
            </div>
            {statusMutation.isError ? (
              <div className="mb-4">
                <ErrorSummary message={getApiErrorMessage(statusMutation.error)} />
              </div>
            ) : null}
            {warehouseMutation.isError ? (
              <div className="mb-4">
                <ErrorSummary message={getApiErrorMessage(warehouseMutation.error)} />
              </div>
            ) : null}
            {capabilityMutation.isError ? (
              <div className="mb-4">
                <ErrorSummary message={getApiErrorMessage(capabilityMutation.error)} />
              </div>
            ) : null}
            <DataTable
              caption="Danh sách hồ sơ tài xế"
              columns={columns}
              emptyDescription="Tạo hồ sơ đầu tiên bằng biểu mẫu bên cạnh."
              emptyTitle="Chưa có hồ sơ tài xế"
              error={drivers.isError ? getApiErrorMessage(drivers.error) : undefined}
              getRowKey={(driver) => driver.id}
              loading={drivers.isPending}
              loadingLabel="Đang tải danh sách tài xế"
              onRetry={() => drivers.refetch()}
              rows={rows}
            />
          </section>
        </div>
      </div>

      <ConfirmDialog
        confirmLabel={capabilityChange?.enable ? 'Bật tuyến liên kho' : 'Gỡ capability'}
        description={
          capabilityChange
            ? capabilityChange.enable
              ? `${capabilityChange.driver.fullName} sẽ có thể được chọn cho chuyến Warehouse → Warehouse.`
              : `${capabilityChange.driver.fullName} sẽ không còn eligible cho chuyến mới. Backend sẽ từ chối nếu tài xế đang giữ một chuyến active.`
            : ''
        }
        destructive={capabilityChange?.enable === false}
        loading={capabilityMutation.isPending}
        onCancel={() => !capabilityMutation.isPending && setCapabilityChange(null)}
        onConfirm={() => {
          if (!capabilityChange) return;
          const capabilities = capabilityChange.enable
            ? [...capabilityChange.driver.capabilities, 'LINE_HAUL' as const]
            : capabilityChange.driver.capabilities.filter(
                (capability) => capability !== 'LINE_HAUL',
              );
          capabilityMutation.mutate({ driverId: capabilityChange.driver.id, capabilities });
        }}
        open={Boolean(capabilityChange)}
        title="Xác nhận năng lực tài xế"
      />
      <ConfirmDialog
        confirmLabel={suspensionChange?.suspended ? 'Đình chỉ tài xế' : 'Khôi phục'}
        description={
          suspensionChange
            ? suspensionChange.suspended
              ? `${suspensionChange.driver.fullName} sẽ ngừng nhận công việc mới. Backend sẽ từ chối nếu tài xế đang giữ nghiệp vụ active.`
              : `${suspensionChange.driver.fullName} sẽ được khôi phục về trạng thái ngoại tuyến.`
            : ''
        }
        destructive={suspensionChange?.suspended === true}
        loading={statusMutation.isPending}
        onCancel={() => !statusMutation.isPending && setSuspensionChange(null)}
        onConfirm={() => {
          if (suspensionChange) {
            statusMutation.mutate({
              driverId: suspensionChange.driver.id,
              suspended: suspensionChange.suspended,
            });
          }
        }}
        open={Boolean(suspensionChange)}
        title={suspensionChange?.suspended ? 'Xác nhận đình chỉ' : 'Xác nhận khôi phục'}
      />
    </AccountLayout>
  );
}
