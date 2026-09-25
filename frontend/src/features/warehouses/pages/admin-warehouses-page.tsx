import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import './admin-warehouses-page.css';
import { Button } from '../../../components/ui/button';
import { DataTable } from '../../../components/ui/data-table';
import type { DataTableColumn } from '../../../components/ui/data-table';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { LoadingState } from '../../../components/ui/loading-state';
import { Modal } from '../../../components/ui/modal';
import { PageHeader } from '../../../components/ui/page-header';
import { Pagination } from '../../../components/ui/pagination';
import { SearchableSelect } from '../../../components/ui/searchable-select';
import { getProvinceWards, normalizeAdministrativeSearch, provinces } from '../../addresses/administrative-model';
import { SelectField } from '../../../components/ui/select-field';
import { getApiErrorMessage } from '../../../services/api-error';
import type { User } from '../../../types/auth';
import { listUsers } from '../../admin/admin-api';
import { AccountLayout } from '../../auth/components/account-layout';
import {
  assignWarehouseStaff,
  createWarehouse,
  updateWarehouse,
  listWarehouses,
  listWarehouseStaff,
  toggleStaffStatus,
  toggleWarehouseStatus,
} from '../warehouses-api';
import {
  filterWarehouseStaffAccounts,
  getEligibleWarehouseStaffAccounts,
  warehouseStaffAccountLabel,
} from '../warehouse-staff-candidates';
import type { Warehouse } from '../warehouse-types';

import { AdministrativeAddressFields } from '../../addresses/administrative-address-fields';
import { LocationPicker } from '../../locations/location-picker';
import { emptyWarehouseForm, warehouseFormSchema, warehouseFormInput, warehouseFormValues, warehouseAddressContext, type WarehouseFormValues } from '../warehouse-form';

const assignStaffSchema = z.object({
  userId: z.uuid('Chọn tài khoản WAREHOUSE_STAFF'),
  staffCode: z
    .string()
    .trim()
    .min(2, 'Tối thiểu 2 ký tự')
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, 'Mã nhân viên chỉ gồm chữ HOA, số, gạch ngang hoặc gạch dưới'),
});

type AssignStaffForm = z.infer<typeof assignStaffSchema>;

async function listAllWarehouseStaffAccounts(): Promise<User[]> {
  const firstUserPage = await listUsers({
    role: 'WAREHOUSE_STAFF',
    status: 'ACTIVE',
    page: 1,
    limit: 50,
  });
  const remainingUserPages = await Promise.all(
    Array.from({ length: firstUserPage.totalPages - 1 }, (_, index) =>
      listUsers({
        role: 'WAREHOUSE_STAFF',
        status: 'ACTIVE',
        page: index + 2,
        limit: 50,
      }),
    ),
  );
  const users = [firstUserPage, ...remainingUserPages].flatMap((page) => page.items);

  const firstWarehousePage = await listWarehouses({ page: 1, limit: 100 });
  const remainingWarehousePages = await Promise.all(
    Array.from({ length: firstWarehousePage.pagination.totalPages - 1 }, (_, index) =>
      listWarehouses({ page: index + 2, limit: 100 }),
    ),
  );
  const allWarehouses = [firstWarehousePage, ...remainingWarehousePages].flatMap(
    (page) => page.items,
  );
  const profiles = (await Promise.all(
    allWarehouses.map((warehouse) => listWarehouseStaff(warehouse.id)),
  )).flat();

  return getEligibleWarehouseStaffAccounts(users, profiles);
}

export function AdminWarehousesPage() {
  const queryClient = useQueryClient();
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedWarehouseForStaff, setSelectedWarehouseForStaff] = useState<Warehouse | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', province: '', ward: '', status: '', page: 1 });
  const province = provinces.find((item) => item.code === filters.province);
  const wardOptions = getProvinceWards(province?.code);
  const ward = wardOptions.find((item) => item.code === filters.ward);
  const hasFilters = Boolean(search || filters.province || filters.ward || filters.status);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => current.search === search.trim() ? current : { ...current, search: search.trim(), page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const warehouses = useQuery({
    queryKey: ['admin-warehouses', filters],
    queryFn: () => listWarehouses({
      search: filters.search || undefined,
      city: province?.name,
      ward: ward?.name,
      isActive: filters.status ? filters.status === 'true' : undefined,
      page: filters.page,
      limit: 20,
    }),
  });

  if (warehouses.data && filters.page > Math.max(1, warehouses.data.pagination.totalPages)) {
    setFilters({ ...filters, page: Math.max(1, warehouses.data.pagination.totalPages) });
  }

  const staffList = useQuery({
    queryKey: ['warehouse-staff', selectedWarehouseForStaff?.id],
    queryFn: () => (selectedWarehouseForStaff ? listWarehouseStaff(selectedWarehouseForStaff.id) : []),
    enabled: Boolean(selectedWarehouseForStaff),
  });

  const staffAccounts = useQuery({
    queryKey: ['warehouse-staff-candidates'],
    queryFn: listAllWarehouseStaffAccounts,
    enabled: Boolean(selectedWarehouseForStaff),
  });

  const { formState: whFormState, handleSubmit: handleWhSubmit, register: registerWh, reset: resetWh, control: whControl, setValue: setWhValue } =
    useForm<WarehouseFormValues>({
      resolver: zodResolver(warehouseFormSchema),
      mode: 'onBlur',
      defaultValues: emptyWarehouseForm,
    });

  const {
    control: staffControl,
    formState: staffFormState,
    handleSubmit: handleStaffSubmit,
    register: registerStaff,
    reset: resetStaff,
    setValue: setStaffValue,
  } = useForm<AssignStaffForm>({
      resolver: zodResolver(assignStaffSchema),
      mode: 'onBlur',
      defaultValues: { userId: '', staffCode: '' },
    });

  const createMutation = useMutation({
    mutationFn: (values: WarehouseFormValues) => {
      const { code, ...input } = warehouseFormInput(values);
      return editingWarehouse ? updateWarehouse(editingWarehouse.id, input) : createWarehouse({ code, ...input });
    },
    onSuccess: async (created) => {
      resetWh(emptyWarehouseForm);
      setEditingWarehouse(null);
      setSuccess(`Đã lưu kho hàng "${created.name}" (${created.code}) thành công.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: toggleWarehouseStatus,
    onSuccess: async (updated) => {
      setSuccess(
        updated.isActive
          ? `Đã kích hoạt kho ${updated.name}.`
          : `Đã tạm dừng hoạt động kho ${updated.name}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });

  const assignStaffMutation = useMutation({
    mutationFn: (values: AssignStaffForm) => {
      if (!selectedWarehouseForStaff) throw new Error('Chưa chọn kho hàng');
      return assignWarehouseStaff(selectedWarehouseForStaff.id, values);
    },
    onSuccess: async (profile) => {
      resetStaff();
      setAccountSearch('');
      setSuccess(`Đã phân công nhân viên ${profile.user.fullName} (${profile.staffCode}) vào kho.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warehouse-staff', selectedWarehouseForStaff?.id] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-staff-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] }),
      ]);
    },
  });

  const warehouseValues = useWatch({ control: whControl, defaultValue: emptyWarehouseForm });
  const warehouseContext = warehouseAddressContext({ ...emptyWarehouseForm, ...warehouseValues });

  const candidateAccounts = staffAccounts.data ?? [];
  const filteredAccounts = filterWarehouseStaffAccounts(candidateAccounts, accountSearch);
  const assignmentFormDisabled =
    assignStaffMutation.isPending ||
    staffAccounts.isPending ||
    staffAccounts.isError ||
    candidateAccounts.length === 0;

  const toggleStaffMutation = useMutation({
    mutationFn: toggleStaffStatus,
    onSuccess: async (profile) => {
      setSuccess(
        profile.isActive
          ? `Đã kích hoạt nhân viên ${profile.user.fullName}.`
          : `Đã tạm ngừng nhân viên ${profile.user.fullName}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warehouse-staff', selectedWarehouseForStaff?.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] }),
      ]);
    },
  });

  const items = warehouses.data?.items ?? [];
  const activeCount = items.filter((w) => w.isActive).length;
  const columns: DataTableColumn<Warehouse>[] = [
    {
      id: 'warehouse',
      header: 'Kho hàng',
      render: (warehouse) => (
        <span className="block">
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-control bg-primary-soft px-2 py-1 font-mono text-xs font-semibold text-primary">
              {warehouse.code}
            </span>
            <span className="font-semibold text-ink">{warehouse.name}</span>
          </span>
          <span className="mt-1.5 block max-w-xl text-xs leading-5 text-muted-foreground">
            {warehouse.address}
            {warehouse.ward ? `, ${warehouse.ward}` : ''}
            {warehouse.district ? `, ${warehouse.district}` : ''}, {warehouse.city}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Hoạt động',
      render: (warehouse) => (
        <span
          className={`inline-flex items-center gap-2 text-sm font-semibold ${warehouse.isActive ? 'text-success' : 'text-muted-foreground'}`}
        >
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${warehouse.isActive ? 'bg-success' : 'bg-slate-400'}`}
          />
          {warehouse.isActive ? 'Đang mở' : 'Tạm dừng'}
        </span>
      ),
    },
    {
      align: 'right',
      id: 'inventory',
      header: 'Tồn kho',
      render: (warehouse) => (
        <span className="font-semibold tabular-nums text-ink">
          {warehouse.activeShipmentsCount ?? 0} kiện
        </span>
      ),
    },
    {
      align: 'right',
      id: 'staff',
      header: 'Nhân viên',
      render: (warehouse) => (
        <span className="font-semibold tabular-nums text-ink">{warehouse.staffCount ?? 0}</span>
      ),
    },
    {
      align: 'right',
      id: 'actions',
      header: 'Thao tác',
      render: (warehouse) => {
        const toggling =
          toggleStatusMutation.isPending && toggleStatusMutation.variables === warehouse.id;
        return (
          <span className="flex flex-col gap-2 md:items-end">
            <Button variant="secondary" disabled={createMutation.isPending} onClick={() => {
              setEditingWarehouse(warehouse);
              resetWh(warehouseFormValues(warehouse));
              createMutation.reset();
              document.getElementById('wh-name')?.focus();
            }}>Sửa kho</Button>
            <Button
              className="w-full md:w-auto"
              onClick={() => {
                resetStaff();
                setAccountSearch('');
                setSelectedWarehouseForStaff(warehouse);
              }}
              variant="secondary"
            >
              Nhân viên
            </Button>
            <Button
              className="w-full md:w-auto"
              disabled={toggleStatusMutation.isPending && !toggling}
              loading={toggling}
              onClick={() => toggleStatusMutation.mutate(warehouse.id)}
              variant={warehouse.isActive ? 'secondary' : 'primary'}
            >
              {warehouse.isActive ? 'Tạm dừng' : 'Kích hoạt'}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          actions={
            <dl className="grid w-full grid-cols-2 gap-3 sm:w-auto">
              <div className="min-w-32 rounded-surface border border-border bg-surface px-4 py-3 shadow-surface">
                <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Kho phù hợp
                </dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
                  {warehouses.isSuccess ? warehouses.data.pagination.total : '—'}
                </dd>
              </div>
              <div className="min-w-32 rounded-surface border border-border bg-surface px-4 py-3 shadow-surface">
                <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Đang mở trên trang
                </dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-success">
                  {warehouses.isSuccess ? activeCount : '—'}
                </dd>
              </div>
            </dl>
          }
          description="Quản lý Hub xuất phát, trung chuyển, kho đích và phân bổ nhân viên kho theo đúng phạm vi vận hành."
          eyebrow="Quản trị hệ thống"
          title="Mạng lưới kho hàng"
        />

        {success ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900"
          >
            {success}
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] md:items-start xl:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-label="Biểu mẫu kho hàng" className="min-w-0 rounded-surface border border-border bg-surface p-5 shadow-surface md:sticky md:top-6 md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto md:overflow-x-hidden">
            <h2 className="text-lg font-semibold text-ink">{editingWarehouse ? 'Sửa kho hàng' : 'Thêm kho hàng mới'}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Khai báo Hub trung chuyển hoặc kho đích mới trong mạng lưới.
            </p>
            <form
              className="mt-5 space-y-4"
              noValidate
              onSubmit={handleWhSubmit((values) => createMutation.mutate(values))}
            >
              <ErrorSummary
                message={createMutation.isError ? getApiErrorMessage(createMutation.error) : undefined}
              />
              <FormField
                error={whFormState.errors.code?.message}
                disabled={Boolean(editingWarehouse)}
                id="wh-code"
                label="Mã kho (viết hoa)"
                placeholder="WH-HAN-01"
                {...registerWh('code')}
              />
              <FormField
                error={whFormState.errors.name?.message}
                id="wh-name"
                label="Tên kho hàng"
                placeholder="Kho Trung Chuyển Hà Nội"
                {...registerWh('name')}
              />
              <AdministrativeAddressFields city={warehouseValues.city} ward={warehouseValues.ward}
                cityError={whFormState.errors.city?.message} wardError={whFormState.errors.ward?.message}
                disabled={createMutation.isPending} onChange={(next) => {
                  setWhValue('city', next.city, { shouldDirty: true });
                  setWhValue('ward', next.ward, { shouldDirty: true });
                  setWhValue('district', next.district, { shouldDirty: true });
                }} />
              {warehouseValues.district && <p className="text-sm text-muted-foreground">Quận/huyện cũ: {warehouseValues.district}</p>}
              <FormField error={whFormState.errors.address?.message} id="wh-address"
                label="Số nhà / tên đường" {...registerWh('address')} />
              <LocationPicker label="Vị trí kho hàng" addressContext={warehouseContext}
                disabled={createMutation.isPending}
                value={warehouseValues.latitude !== undefined && warehouseValues.longitude !== undefined
                  ? { latitude: warehouseValues.latitude, longitude: warehouseValues.longitude } : undefined}
                confirmedAddressFingerprint={warehouseValues.confirmedAddressFingerprint}
                onChange={(point, fingerprint) => {
                  setWhValue('latitude', point.latitude, { shouldDirty: true });
                  setWhValue('longitude', point.longitude, { shouldDirty: true });
                  setWhValue('confirmedAddressFingerprint', fingerprint, { shouldDirty: true, shouldValidate: true });
                }} />
              {whFormState.errors.confirmedAddressFingerprint && <p role="alert" className="text-sm text-danger">{whFormState.errors.confirmedAddressFingerprint.message}</p>}
              {editingWarehouse && <Button variant="secondary" disabled={createMutation.isPending} onClick={() => {
                setEditingWarehouse(null); resetWh(emptyWarehouseForm); createMutation.reset();
              }}>Hủy sửa</Button>}
              <Button className="w-full" loading={createMutation.isPending} type="submit">
                {editingWarehouse ? 'Lưu thay đổi' : 'Tạo kho hàng'}
              </Button>
            </form>
          </section>

          <section className="warehouse-list-results min-w-0" aria-labelledby="warehouse-list-title">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-ink" id="warehouse-list-title">
                Danh sách kho trong hệ thống
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Theo dõi trạng thái, tồn kho và nhân sự trên cùng một bảng vận hành.
              </p>
            </div>
            <div className="mb-4 space-y-4 rounded-surface border border-border bg-surface p-4">
              <FormField id="warehouse-search" label="Tìm kho" placeholder="Mã kho, tên kho hoặc địa chỉ" value={search} onChange={(event) => setSearch(event.target.value)} />
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                <SearchableSelect label="Lọc tỉnh / thành phố" value={filters.province}
                  placeholder="Tất cả tỉnh/thành" normalizeSearch={normalizeAdministrativeSearch}
                  options={[{ value: '', label: 'Tất cả tỉnh/thành', searchText: '' }, ...provinces.map((item) => ({ value: item.code, label: item.name, searchText: item.name }))]}
                  onChange={(value) => setFilters((current) => ({ ...current, province: value, ward: '', page: 1 }))} />
                <SearchableSelect key={filters.province} label="Lọc phường / xã" value={filters.ward}
                  placeholder={province ? 'Tất cả phường/xã' : 'Chọn tỉnh/thành trước'} disabled={!province} normalizeSearch={normalizeAdministrativeSearch}
                  options={[{ value: '', label: 'Tất cả phường/xã', searchText: '' }, ...wardOptions.map((item) => ({ value: item.code, label: item.name, searchText: item.name }))]}
                  onChange={(value) => setFilters((current) => ({ ...current, ward: value, page: 1 }))} />
                <SelectField id="warehouse-status" label="Trạng thái kho" value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value, page: 1 }))}>
                  <option value="">Tất cả</option><option value="true">Đang mở</option><option value="false">Tạm dừng</option>
                </SelectField>
                <Button variant="secondary" className="self-end" disabled={!hasFilters} onClick={() => {
                  setSearch(''); setFilters({ search: '', province: '', ward: '', status: '', page: 1 });
                }}>Xóa bộ lọc</Button>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {warehouses.isPending ? 'Đang tìm kho…' : warehouses.isError ? 'Không thể tải số kho phù hợp.' : `${warehouses.data.pagination.total} kho phù hợp`}
              </p>
            </div>
            {toggleStatusMutation.isError ? (
              <div className="mb-4">
                <ErrorSummary message={getApiErrorMessage(toggleStatusMutation.error)} />
              </div>
            ) : null}
            <DataTable
              caption="Danh sách kho hàng"
              columns={columns}
              emptyDescription={hasFilters ? 'Thử từ khóa khác hoặc xóa bộ lọc.' : 'Thêm kho đầu tiên bằng biểu mẫu bên cạnh.'}
              emptyTitle={hasFilters ? 'Không có kho phù hợp' : 'Chưa có kho hàng'}
              error={warehouses.isError ? getApiErrorMessage(warehouses.error) : undefined}
              getRowKey={(warehouse) => warehouse.id}
              loading={warehouses.isPending}
              loadingLabel="Đang tải danh sách kho hàng"
              onRetry={() => warehouses.refetch()}
              rows={items}
            />
            {warehouses.data && <div className="mt-4"><Pagination page={filters.page} totalPages={warehouses.data.pagination.totalPages}
              disabled={warehouses.isFetching} onPageChange={(page) => setFilters((current) => ({ ...current, page }))} /></div>}
          </section>
        </div>

        {selectedWarehouseForStaff ? (
          <Modal
            description={`${selectedWarehouseForStaff.city} · ${selectedWarehouseForStaff.code}`}
            onClose={() => {
              resetStaff();
              setAccountSearch('');
              setSelectedWarehouseForStaff(null);
            }}
            open
            size="lg"
            title={`Nhân viên kho: ${selectedWarehouseForStaff.name}`}
          >
              <div className="rounded-surface border border-border bg-surface-subtle p-4 sm:p-5">
                <h3 className="font-semibold text-ink">Phân công tài khoản nhân viên kho mới</h3>
                <form
                  className="mt-4 space-y-4"
                  noValidate
                  onSubmit={handleStaffSubmit((values) => assignStaffMutation.mutate(values))}
                >
                  <ErrorSummary
                    message={
                      assignStaffMutation.isError
                        ? getApiErrorMessage(assignStaffMutation.error)
                        : undefined
                    }
                  />
                  <FormField
                    autoComplete="off"
                    disabled={assignmentFormDisabled}
                    helperText={
                      staffAccounts.isSuccess && candidateAccounts.length > 0
                        ? `${candidateAccounts.length} tài khoản có thể phân công.`
                        : 'Tìm theo họ tên hoặc email.'
                    }
                    id="warehouse-staff-account-search"
                    label="Tìm tài khoản nhân viên kho"
                    onChange={(event) => {
                      setAccountSearch(event.target.value);
                      setStaffValue('userId', '', { shouldValidate: false });
                    }}
                    placeholder="Ví dụ: warehouse@test.com"
                    type="search"
                    value={accountSearch}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Controller
                      control={staffControl}
                      name="userId"
                      render={({ field }) => (
                        <SelectField
                          disabled={assignmentFormDisabled}
                          error={staffFormState.errors.userId?.message}
                          helperText="Chỉ gồm tài khoản active chưa được gán vào kho nào."
                          id="staff-user-id"
                          label="Tài khoản WAREHOUSE_STAFF"
                          {...field}
                        >
                          <option value="">
                            {staffAccounts.isPending
                              ? 'Đang tải tài khoản...'
                              : staffAccounts.isError
                                ? 'Không thể tải tài khoản'
                                : candidateAccounts.length === 0
                                  ? 'Chưa có tài khoản phù hợp'
                                  : filteredAccounts.length === 0
                                    ? 'Không tìm thấy kết quả'
                                    : 'Chọn tài khoản'}
                          </option>
                          {filteredAccounts.map((user) => (
                            <option key={user.id} value={user.id}>
                              {warehouseStaffAccountLabel(user)}
                            </option>
                          ))}
                        </SelectField>
                      )}
                    />
                    <FormField
                      disabled={assignmentFormDisabled}
                      error={staffFormState.errors.staffCode?.message}
                      id="staff-code"
                      label="Mã nhân viên"
                      placeholder="STF-HAN-001"
                      {...registerStaff('staffCode')}
                    />
                  </div>
                  {staffAccounts.isPending ? (
                    <LoadingState compact label="Đang tải tài khoản nhân viên kho có thể phân công" />
                  ) : staffAccounts.isError ? (
                    <ErrorState
                      compact
                      message={getApiErrorMessage(staffAccounts.error)}
                      onRetry={() => staffAccounts.refetch()}
                      title="Không thể tải tài khoản nhân viên kho"
                    />
                  ) : candidateAccounts.length === 0 ? (
                    <EmptyState
                      action={
                        <Link
                          className="focus-ring rounded-control border border-border-strong bg-surface px-4 py-3 text-sm font-semibold text-primary hover:border-primary hover:bg-primary-soft"
                          to="/admin/staff/new"
                        >
                          Tạo tài khoản nhân viên kho
                        </Link>
                      }
                      compact
                      description="Tạo tài khoản WAREHOUSE_STAFF active trước, hoặc kiểm tra các tài khoản đã được phân công."
                      title="Không có tài khoản để phân công"
                    />
                  ) : null}
                  <Button
                    className="w-full sm:w-auto"
                    disabled={assignmentFormDisabled}
                    loading={assignStaffMutation.isPending}
                    type="submit"
                  >
                    Phân công vào kho
                  </Button>
                </form>
              </div>

              <section className="mt-6" aria-labelledby="warehouse-staff-list-title">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink" id="warehouse-staff-list-title">
                    Nhân viên hiện tại
                  </h3>
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
                    {staffList.data?.length ?? 0} người
                  </span>
                </div>
                {toggleStaffMutation.isError ? (
                  <div className="mb-3">
                    <ErrorSummary message={getApiErrorMessage(toggleStaffMutation.error)} />
                  </div>
                ) : null}
                {staffList.isPending ? (
                  <LoadingState label="Đang tải danh sách nhân viên" />
                ) : staffList.isError ? (
                  <ErrorState
                    compact
                    message={getApiErrorMessage(staffList.error)}
                    onRetry={() => staffList.refetch()}
                  />
                ) : !staffList.data?.length ? (
                  <EmptyState
                    compact
                    description="Phân công tài khoản WAREHOUSE_STAFF bằng biểu mẫu phía trên."
                    title="Chưa có nhân viên tại kho"
                  />
                ) : (
                  <div className="divide-y divide-border rounded-surface border border-border bg-surface">
                    {staffList.data?.map((staff) => (
                      <div
                        key={staff.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">
                              {staff.staffCode}
                            </span>
                            <span className="font-semibold text-ink">{staff.user.fullName}</span>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${staff.isActive ? 'text-success' : 'text-muted-foreground'}`}>
                              <span aria-hidden="true" className={`size-1.5 rounded-full ${staff.isActive ? 'bg-success' : 'bg-slate-400'}`} />
                              {staff.isActive ? 'Đang hoạt động' : 'Tạm ngừng'}
                            </span>
                          </div>
                          <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">
                            {staff.user.email} {staff.user.phone ? `• ${staff.user.phone}` : ''}
                          </p>
                        </div>
                        <Button
                          className="w-full sm:w-auto"
                          disabled={
                            toggleStaffMutation.isPending &&
                            toggleStaffMutation.variables !== staff.id
                          }
                          loading={
                            toggleStaffMutation.isPending &&
                            toggleStaffMutation.variables === staff.id
                          }
                          onClick={() => toggleStaffMutation.mutate(staff.id)}
                          variant={staff.isActive ? 'secondary' : 'primary'}
                        >
                          {staff.isActive ? 'Tạm ngừng' : 'Kích hoạt'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
          </Modal>
        ) : null}
      </div>
    </AccountLayout>
  );
}
