import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../components/ui/data-table';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchFilter } from '../../components/ui/search-filter';
import { Select } from '../../components/ui/select';
import { getApiErrorMessage } from '../../services/api-error';
import type { UserRole } from '../../types/auth';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { listAuditLogs, type AuditLog } from './admin-api';

const roleLabels: Record<UserRole, string> = { CUSTOMER: 'Khách hàng', DRIVER: 'Tài xế', WAREHOUSE_STAFF: 'Nhân viên kho', DISPATCHER: 'Điều phối', ADMIN: 'Quản trị' };

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <details>
      <summary className="focus-ring min-h-11 cursor-pointer rounded-control py-2 font-semibold text-primary">{label}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-control bg-surface-muted p-3 text-xs leading-5 text-ink">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

const columns: DataTableColumn<AuditLog>[] = [
  { id: 'createdAt', header: 'Thời gian', render: (row) => dateTimeFormatter.format(new Date(row.createdAt)) },
  { id: 'actor', header: 'Actor', render: (row) => <div><p className="font-semibold text-ink">{row.actor?.fullName ?? 'Hệ thống'}</p><p className="text-xs text-muted-foreground">{roleLabels[row.actorRole]}</p></div> },
  { id: 'action', header: 'Hành động', render: (row) => <span className="font-mono text-sm font-semibold text-primary">{row.action}</span> },
  { id: 'entity', header: 'Đối tượng', render: (row) => <div><p className="font-semibold">{row.entityType}</p><p className="wrap-anywhere font-mono text-xs text-muted-foreground">{row.entityId}</p></div> },
  { id: 'changes', header: 'Thay đổi', render: (row) => <div className="space-y-1"><JsonDetails label="Before" value={row.before} /><JsonDetails label="After" value={row.after} /><JsonDetails label="Metadata" value={row.metadata} /></div> },
  { id: 'request', header: 'Request', render: (row) => <div><p className="wrap-anywhere text-xs">{row.ipAddress || 'Không có IP'}</p><p className="mt-1 max-w-64 wrap-anywhere text-xs text-muted-foreground">{row.userAgent || 'Không có user agent'}</p></div> },
];

export function AuditLogsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const actorRole = (params.get('role') || '') as UserRole | '';
  const action = params.get('action') ?? '';
  const entityType = params.get('entity') ?? '';
  const fromDate = params.get('from') ?? '';
  const toDate = params.get('to') ?? '';
  const logs = useQuery({
    queryKey: ['admin-audit-logs', { page, search, actorRole, action, entityType, fromDate, toDate }],
    queryFn: () => listAuditLogs({ page, search: search || undefined, actorRole: actorRole || undefined, action: action || undefined, entityType: entityType || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.set('page', '1'); setParams(next); };
  return (
    <AccountLayout>
      <main className="mx-auto max-w-7xl">
        <PageHeader description="Lịch sử nội bộ append-only, chỉ Admin truy cập; TrackingEvent công khai không bị trộn vào đây." eyebrow="Admin workspace" title="Audit Logs" />
        <div className="mt-6"><SearchFilter onChange={(value) => update('search', value)} onClear={() => update('search', '')} placeholder="Action, entity, ID hoặc actor" value={search}><label className="min-w-44 text-sm font-semibold text-ink">Vai trò actor<Select className="mt-1.5" onChange={(event) => update('role', event.target.value)} value={actorRole}><option value="">Tất cả</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label><label className="text-sm font-semibold text-ink">Từ ngày<Input className="mt-1.5" onChange={(event) => update('from', event.target.value)} type="date" value={fromDate} /></label><label className="text-sm font-semibold text-ink">Đến ngày<Input className="mt-1.5" onChange={(event) => update('to', event.target.value)} type="date" value={toDate} /></label></SearchFilter></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-ink">Action<Input className="mt-1.5" onChange={(event) => update('action', event.target.value)} placeholder="VD: SHIPMENT_CANCEL" value={action} /></label><label className="text-sm font-semibold text-ink">Entity type<Input className="mt-1.5" onChange={(event) => update('entity', event.target.value)} placeholder="VD: Shipment" value={entityType} /></label></div>
        <div className="mt-6"><DataTable caption="Nhật ký kiểm toán nội bộ" columns={columns} emptyTitle="Không có audit log phù hợp" error={logs.isError ? getApiErrorMessage(logs.error) : undefined} getRowKey={(row) => row.id} loading={logs.isPending} onRetry={() => void logs.refetch()} rows={logs.data?.items ?? []} /></div>
        {logs.data ? <div className="mt-5"><Pagination disabled={logs.isFetching} onPageChange={(nextPage) => update('page', String(nextPage))} page={logs.data.page} totalPages={logs.data.totalPages} /></div> : null}
      </main>
    </AccountLayout>
  );
}
