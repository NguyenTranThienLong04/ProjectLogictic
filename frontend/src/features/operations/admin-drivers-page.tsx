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
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { Modal } from '../../components/ui/modal';
import { SelectField } from '../../components/ui/select-field';
import { getApiErrorMessage } from '../../services/api-error';
import type { User } from '../../types/auth';
import { listUsers } from '../admin/admin-api';
import { normalizeAdministrativeSearch } from '../addresses/administrative-model';
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
import type { DriverCapability, DriverProfile, DriverStatus, Paginated } from './operations-types';

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
    <span
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold ${presentation.text}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${presentation.dot}`} />
      {presentation.label}
    </span>
  );
}

export function AdminDriversPage() {
  const queryClient = useQueryClient();
  const [accountSearch, setAccountSearch] = useState('');
  const [success, setSuccess] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    capability: '',
    operatingWarehouseId: '',
    status: '',
    page: 1,
  });
  const [warehouseChange, setWarehouseChange] = useState<DriverProfile | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [capabilityChange, setCapabilityChange] = useState<{
    driver: DriverProfile;
    enable: boolean;
  } | null>(null);
  const [suspensionChange, setSuspensionChange] = useState<{
    driver: DriverProfile;
    suspended: boolean;
  } | null>(null);
  const drivers = useQuery({
    queryKey: ['drivers', 'admin-list', filters],
    queryFn: () =>
      listDrivers({
        search: filters.search || undefined,
        capability: (filters.capability || undefined) as DriverCapability | undefined,
        operatingWarehouseId: filters.operatingWarehouseId || undefined,
        status: (filters.status || undefined) as DriverStatus | undefined,
        page: filters.page,
        limit: 20,
      }),
  });
  const driverAccounts = useQuery({
    queryKey: ['driver-profile-candidates'],
    queryFn: listDriverProfileCandidates,
  });
  const warehouses = useQuery({
    queryKey: ['warehouses', 'driver-operating-areas'],
    queryFn: () =>
      collectPages(async (page) => {
        const result = await listWarehouses({ page, limit: 100 });
        return { items: result.items, ...result.pagination };
      }),
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
      setFilters((current) => ({ ...current, page: 1 }));
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
      setFilters((current) => ({ ...current, page: 1 }));
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
      setFilters((current) => ({ ...current, page: 1 }));
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
      setWarehouseChange(null);
      setFilters((current) => ({ ...current, page: 1 }));
      setSuccess(`Đã cập nhật kho vận hành cho ${driver.fullName}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drivers'] }),
        queryClient.invalidateQueries({ queryKey: ['assignment-candidates'] }),
      ]);
    },
  });

  const candidateAccounts = driverAccounts.data ?? [];
  const warehouseOptions = (warehouses.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: `[${warehouse.code}] ${warehouse.name} — ${warehouse.city}`,
    searchText: `${warehouse.code} ${warehouse.name} ${warehouse.city}`,
  }));
  const activeWarehouseOptions = warehouseOptions.filter((option) =>
    warehouses.data?.some((warehouse) => warehouse.id === option.value && warehouse.isActive),
  );
  const filteredAccounts = filterDriverAccounts(candidateAccounts, accountSearch);
  const profileFormDisabled =
    createMutation.isPending ||
    driverAccounts.isPending ||
    driverAccounts.isError ||
    candidateAccounts.length === 0 ||
    warehouses.isPending ||
    warehouses.isError ||
    !activeWarehouseOptions.length;
  const rows = drivers.data?.items ?? [];
  const columns: DataTableColumn<DriverProfile>[] = [
    {
      id: 'driver',
      header: 'Tài xế',
      render: (driver) => (
        <span className="block max-w-full lg:w-44">
          <span title={driver.fullName} className="block truncate font-semibold text-ink">
            {driver.fullName}
          </span>
          <span
            title={driver.email}
            className="mt-0.5 block truncate text-xs text-muted-foreground"
          >
            {driver.email}
          </span>
        </span>
      ),
    },
    {
      id: 'employeeCode',
      header: 'Mã NV',
      render: (driver) => (
        <span
          title={driver.employeeCode}
          className="block truncate font-mono text-xs font-semibold text-primary lg:w-24"
        >
          {driver.employeeCode}
        </span>
      ),
    },
    {
      id: 'vehicle',
      header: 'Phương tiện',
      render: (driver) => (
        <span className="block whitespace-nowrap">
          <span className="block font-medium text-ink">{driver.vehicleType}</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
            {driver.vehiclePlate}
          </span>
        </span>
      ),
    },
    {
      id: 'capabilities',
      header: 'Năng lực',
      render: (driver) => {
        const hasLineHaul = driver.capabilities.includes('LINE_HAUL');
        const pending =
          capabilityMutation.isPending && capabilityMutation.variables.driverId === driver.id;
        return (
          <div className="min-w-0 lg:min-w-48">
            <div className="flex flex-wrap gap-1.5">
              {driver.capabilities.map((capability) => {
                const presentation = capabilityPresentation[capability];
                return (
                  <span
                    className={`inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${presentation.className}`}
                    key={capability}
                  >
                    {presentation.label}
                  </span>
                );
              })}
            </div>
            <Button
              className="mt-2 w-full whitespace-nowrap lg:w-auto"
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
      header: 'Kho vận hành',
      render: (driver) => {
        const busy =
          warehouseMutation.isPending && warehouseMutation.variables.driverId === driver.id;
        return (
          <div className="min-w-0 lg:w-44">
            <p className="truncate font-semibold" title={driver.operatingWarehouse?.name}>
              {driver.operatingWarehouse?.name ?? 'Chưa cấu hình'}
            </p>
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              title={driver.operatingWarehouse?.code}
            >
              {driver.operatingWarehouse?.code}
            </p>
            <Button
              className="mt-2 whitespace-nowrap"
              variant="secondary"
              disabled={
                driver.status === 'BUSY' || busy || warehouses.isPending || warehouses.isError
              }
              onClick={() => {
                warehouseMutation.reset();
                setWarehouseId(driver.operatingWarehouse?.id ?? '');
                setWarehouseChange(driver);
              }}
            >
              Đổi kho
            </Button>
            {driver.status === 'BUSY' && (
              <p className="mt-1 text-xs text-muted-foreground">Đang có công việc</p>
            )}
          </div>
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
            className="w-full whitespace-nowrap lg:w-auto"
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
      <div className="min-w-0">
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

        <div className="mt-6 grid items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
          <section
            aria-label="Tạo hồ sơ tài xế"
            className="min-w-0 rounded-surface border border-border bg-surface p-5 shadow-surface md:sticky md:top-6 md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto"
          >
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
                  <SearchableSelect
                    disabled={profileFormDisabled}
                    error={formState.errors.operatingWarehouseId?.message}
                    label="Kho vận hành"
                    placeholder="Tìm mã kho, tên hoặc tỉnh/TP"
                    options={activeWarehouseOptions}
                    normalizeSearch={normalizeAdministrativeSearch}
                    value={field.value}
                    onChange={field.onChange}
                  />
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
              ) : activeWarehouseOptions.length === 0 ? (
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
            <div className="mb-4 space-y-3">
              <SearchFilter
                label="Tìm tài xế"
                placeholder="Tên, email hoặc mã nhân viên"
                value={searchDraft}
                onChange={setSearchDraft}
                onClear={() => {
                  setSearchDraft('');
                  setFilters((current) => ({ ...current, search: '', page: 1 }));
                }}
                onSubmit={() =>
                  setFilters((current) => ({
                    ...current,
                    search: searchDraft.trim().slice(0, 100),
                    page: 1,
                  }))
                }
              >
                <Button className="whitespace-nowrap" type="submit">
                  Tìm kiếm
                </Button>
              </SearchFilter>
              <div className="grid gap-3 xl:grid-cols-2">
                <SelectField
                  id="driver-capability-filter"
                  label="Lọc năng lực"
                  value={filters.capability}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      capability: event.target.value,
                      page: 1,
                    }))
                  }
                >
                  <option value="">Tất cả năng lực</option>
                  <option value="PICKUP">Pickup / Lấy hàng</option>
                  <option value="DELIVERY">Delivery / Giao hàng</option>
                  <option value="LINE_HAUL">Line-haul / Tuyến liên kho</option>
                </SelectField>
                <SearchableSelect
                  label="Lọc kho vận hành"
                  placeholder="Tìm mã kho, tên hoặc tỉnh/TP"
                  options={[
                    { value: '', label: 'Tất cả kho', searchText: '' },
                    ...warehouseOptions,
                  ]}
                  normalizeSearch={normalizeAdministrativeSearch}
                  value={filters.operatingWarehouseId}
                  disabled={warehouses.isPending || warehouses.isError}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, operatingWarehouseId: value, page: 1 }))
                  }
                />
                <SelectField
                  id="driver-status-filter"
                  label="Lọc khả dụng"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value, page: 1 }))
                  }
                >
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(driverStatusPresentation).map(([value, presentation]) => (
                    <option key={value} value={value}>
                      {presentation.label}
                    </option>
                  ))}
                </SelectField>
                <Button
                  className="self-end"
                  variant="secondary"
                  onClick={() => {
                    setSearchDraft('');
                    setFilters({
                      search: '',
                      capability: '',
                      operatingWarehouseId: '',
                      status: '',
                      page: 1,
                    });
                  }}
                >
                  Xóa bộ lọc
                </Button>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {drivers.isPending
                  ? 'Đang tải tài xế…'
                  : drivers.isError
                    ? 'Không thể tải danh sách'
                    : `${drivers.data.total} tài xế phù hợp`}
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
              wide
              caption="Danh sách hồ sơ tài xế"
              columns={columns}
              emptyDescription="Thử thay đổi hoặc xóa bộ lọc, hoặc tạo hồ sơ mới."
              emptyTitle="Không có tài xế phù hợp"
              error={drivers.isError ? getApiErrorMessage(drivers.error) : undefined}
              getRowKey={(driver) => driver.id}
              loading={drivers.isPending}
              loadingLabel="Đang tải danh sách tài xế"
              onRetry={() => drivers.refetch()}
              rows={rows}
            />
            <div className="mt-4">
              <Pagination
                page={filters.page}
                totalPages={drivers.data?.totalPages ?? 0}
                disabled={drivers.isFetching}
                onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
              />
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={Boolean(warehouseChange)}
        title="Đổi kho vận hành"
        description={warehouseChange?.fullName}
        onClose={() => !warehouseMutation.isPending && setWarehouseChange(null)}
        footer={
          <Button
            disabled={!warehouseId || warehouseId === warehouseChange?.operatingWarehouse?.id}
            loading={warehouseMutation.isPending}
            onClick={() => {
              if (warehouseChange)
                warehouseMutation.mutate({
                  driverId: warehouseChange.id,
                  operatingWarehouseId: warehouseId,
                });
            }}
          >
            Lưu kho vận hành
          </Button>
        }
      >
        <div className="min-h-80 space-y-4">
          {warehouseMutation.isError && (
            <ErrorSummary message={getApiErrorMessage(warehouseMutation.error)} />
          )}
          <SearchableSelect
            label="Kho vận hành mới"
            placeholder="Tìm mã kho, tên hoặc tỉnh/TP"
            value={warehouseId}
            onChange={setWarehouseId}
            options={activeWarehouseOptions}
            normalizeSearch={normalizeAdministrativeSearch}
            disabled={warehouseMutation.isPending}
          />
          <p className="text-sm text-muted-foreground">
            Không thể đổi kho khi tài xế đang có công việc đang thực hiện.
          </p>
        </div>
      </Modal>
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
