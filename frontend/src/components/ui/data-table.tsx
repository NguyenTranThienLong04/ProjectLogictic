import type { ReactNode } from 'react';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  mobileLabel?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Wide operational tables use cards until desktop and scroll within their own region. */
  wide?: boolean;
}

const alignments = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

export function DataTable<T>({
  caption,
  columns,
  emptyDescription,
  emptyTitle = 'Chưa có dữ liệu',
  error,
  getRowKey,
  loading = false,
  loadingLabel = 'Đang tải dữ liệu bảng',
  onRetry,
  rows,
  wide = false,
}: DataTableProps<T>) {
  if (loading) return <LoadingState label={loadingLabel} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return <EmptyState description={emptyDescription} title={emptyTitle} />;

  return (
    <div
      className={wide ? 'w-full min-w-0 overflow-x-auto focus-ring' : 'w-full'}
      tabIndex={wide ? 0 : undefined}
      role={wide ? 'region' : undefined}
      aria-label={wide ? caption : undefined}
    >
      <table
        className={`block w-full border-separate border-spacing-0 ${wide ? 'lg:table lg:min-w-[1160px]' : 'md:table'}`}
        role="table"
      >
        <caption className="sr-only">{caption}</caption>
        <thead
          className={`hidden bg-surface-subtle ${wide ? 'lg:table-header-group' : 'md:table-header-group'}`}
        >
          <tr role="row">
            {columns.map((column) => (
              <th
                className={`border-y border-border px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground first:border-l first:rounded-l-control last:border-r last:rounded-r-control ${alignments[column.align ?? 'left']}`}
                key={column.id}
                role="columnheader"
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          className={`grid gap-3 ${wide ? 'lg:table-row-group' : 'md:table-row-group'}`}
          role="rowgroup"
        >
          {rows.map((row) => (
            <tr
              className={`grid gap-2 rounded-surface border border-border bg-surface p-4 shadow-surface ${wide ? 'lg:table-row lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' : 'md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none'}`}
              key={getRowKey(row)}
              role="row"
            >
              {columns.map((column) => (
                <td
                  className={`grid min-w-0 grid-cols-1 items-start gap-1 py-1 text-sm text-ink sm:grid-cols-[minmax(7rem,0.45fr)_minmax(0,1fr)] sm:gap-3 ${wide ? 'lg:table-cell lg:border-b lg:border-border lg:px-4 lg:py-3' : 'md:table-cell md:border-b md:border-border md:px-4 md:py-3'} ${alignments[column.align ?? 'left']} ${column.className ?? ''}`}
                  key={column.id}
                  role="cell"
                >
                  <span
                    aria-hidden="true"
                    className={`text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground ${wide ? 'lg:hidden' : 'md:hidden'}`}
                  >
                    {column.mobileLabel ??
                      (typeof column.header === 'string' ? column.header : column.id)}
                  </span>
                  <span
                    className={wide ? 'min-w-0 wrap-normal break-normal' : 'min-w-0 wrap-anywhere'}
                  >
                    {column.render(row)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
