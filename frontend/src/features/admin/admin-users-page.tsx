import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { ErrorSummary } from '../../components/ui/error-summary';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { StatusBadge } from '../../components/ui/status-badge';
import { getApiErrorMessage } from '../../services/api-error';
import type { User, UserRole, UserStatus } from '../../types/auth';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { useAuth } from '../auth/auth-context';
import { listUsers, setUserStatus } from './admin-api';

const roleLabels: Record<UserRole, string> = { CUSTOMER: 'Khách hàng', DRIVER: 'Tài xế', WAREHOUSE_STAFF: 'Nhân viên kho', DISPATCHER: 'Điều phối', ADMIN: 'Quản trị' };

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<User | null>(null);
  const [success, setSuccess] = useState('');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const role = (params.get('role') || '') as UserRole | '';
  const status = (params.get('status') || '') as UserStatus | '';
  const users = useQuery({ queryKey: ['admin-users', { page, search, role, status }], queryFn: () => listUsers({ page, search: search || undefined, role: role || undefined, status: status || undefined }) });
  const changeStatus = useMutation({
    mutationFn: (selected: User) => setUserStatus(selected.id, selected.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'),
    onSuccess: async (updated) => {
      setSuccess(updated.status === 'ACTIVE' ? `Đã khôi phục ${updated.fullName}.` : `Đã tạm khóa ${updated.fullName}.`);
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.set('page', '1'); setParams(next); };
  const columns: DataTableColumn<User>[] = [
    { id: 'user', header: 'Người dùng', render: (row) => <div><p className="font-semibold text-ink">{row.fullName}</p><p className="text-xs text-muted-foreground">{row.email}</p></div> },
    { id: 'role', header: 'Vai trò', render: (row) => roleLabels[row.role] },
    { id: 'status', header: 'Trạng thái', render: (row) => <StatusBadge appearance={row.status === 'ACTIVE' ? { label: 'Đang hoạt động', surface: 'border-success/30 bg-success-soft text-success', dot: 'bg-success' } : { label: 'Tạm khóa', surface: 'border-danger/30 bg-red-50 text-danger', dot: 'bg-danger' }} /> },
    { id: 'createdAt', header: 'Ngày tạo', render: (row) => dateTimeFormatter.format(new Date(row.createdAt)) },
    { id: 'action', header: 'Thao tác', render: (row) => <Button disabled={row.id === currentUser?.id || changeStatus.isPending} onClick={() => setTarget(row)} variant={row.status === 'ACTIVE' ? 'danger' : 'secondary'}>{row.status === 'ACTIVE' ? 'Tạm khóa' : 'Khôi phục'}</Button> },
  ];
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader actions={<Link className="focus-ring inline-flex min-h-12 items-center rounded-control bg-primary px-4 font-semibold text-on-primary" to="/admin/staff/new">Tạo tài khoản nhân sự</Link>} description="Tra cứu và quản lý trạng thái tài khoản; mọi thay đổi được audit và vô hiệu token cũ." eyebrow="Admin workspace" title="Người dùng" />
        {success ? <p aria-live="polite" className="mt-5 rounded-control border border-success/30 bg-success-soft p-4 font-semibold text-success">{success}</p> : null}
        {changeStatus.isError ? <div className="mt-5"><ErrorSummary message={getApiErrorMessage(changeStatus.error)} /></div> : null}
        <div className="mt-6"><SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Tên, email hoặc số điện thoại" value={search}><label className="min-w-44 text-sm font-semibold text-ink">Vai trò<Select className="mt-1.5" onChange={(event) => update('role', event.target.value)} value={role}><option value="">Tất cả</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label><label className="min-w-44 text-sm font-semibold text-ink">Trạng thái<Select className="mt-1.5" onChange={(event) => update('status', event.target.value)} value={status}><option value="">Tất cả</option><option value="ACTIVE">Hoạt động</option><option value="SUSPENDED">Tạm khóa</option></Select></label></SearchFilter></div>
        <div className="mt-6"><DataTable caption="Danh sách người dùng" columns={columns} emptyTitle="Không có người dùng phù hợp" error={users.isError ? getApiErrorMessage(users.error) : undefined} getRowKey={(row) => row.id} loading={users.isPending} onRetry={() => void users.refetch()} rows={users.data?.items ?? []} /></div>
        {users.data ? <div className="mt-5"><Pagination disabled={users.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={users.data.page} totalPages={users.data.totalPages} /></div> : null}
        <ConfirmDialog destructive={target?.status === 'ACTIVE'} description={target ? `${target.status === 'ACTIVE' ? 'Tạm khóa' : 'Khôi phục'} tài khoản ${target.fullName}. Tài xế có nhiệm vụ active sẽ bị backend từ chối tạm khóa.` : ''} loading={changeStatus.isPending} onCancel={() => setTarget(null)} onConfirm={() => { if (target) changeStatus.mutate(target); }} open={Boolean(target)} title={target?.status === 'ACTIVE' ? 'Tạm khóa tài khoản?' : 'Khôi phục tài khoản?'} />
      </main>
    </AccountLayout>
  );
}
