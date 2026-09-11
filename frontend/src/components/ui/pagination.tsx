interface PaginationProps {
  page: number;
  totalPages: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  label?: string;
}

function visiblePages(page: number, totalPages: number) {
  const first = Math.max(1, Math.min(page - 1, totalPages - 2));
  const last = Math.min(totalPages, Math.max(page + 1, 3));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

export function Pagination({
  disabled = false,
  label = 'Phân trang',
  onPageChange,
  page,
  totalPages,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const pages = visiblePages(page, totalPages);

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-medium tabular-nums text-muted-foreground">
        Trang <span className="text-ink">{page}</span> / {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="focus-ring ui-transition min-h-11 cursor-pointer rounded-control border border-border bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-border-strong hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Trước
        </button>
        <div className="hidden items-center gap-2 sm:flex">
          {pages[0] > 1 ? <span aria-hidden="true" className="px-1 text-muted-foreground">…</span> : null}
          {pages.map((value) => (
            <button
              aria-current={value === page ? 'page' : undefined}
              aria-label={`Trang ${value}`}
              className={`focus-ring ui-transition grid size-11 cursor-pointer place-items-center rounded-control border text-sm font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                value === page
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-muted'
              }`}
              disabled={disabled}
              key={value}
              onClick={() => onPageChange(value)}
              type="button"
            >
              {value}
            </button>
          ))}
          {pages.at(-1)! < totalPages ? (
            <span aria-hidden="true" className="px-1 text-muted-foreground">…</span>
          ) : null}
        </div>
        <button
          className="focus-ring ui-transition min-h-11 cursor-pointer rounded-control border border-border bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-border-strong hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Sau
        </button>
      </div>
    </nav>
  );
}
