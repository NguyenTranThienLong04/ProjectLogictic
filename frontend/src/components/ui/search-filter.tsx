import { useId } from 'react';
import type { ChangeEvent, FormEvent, PropsWithChildren } from 'react';
import { Input } from './input';

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onClear?: () => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchFilter({
  children,
  disabled = false,
  label = 'Tìm kiếm',
  onChange,
  onClear,
  onSubmit,
  placeholder = 'Nhập từ khóa',
  value,
}: PropsWithChildren<SearchFilterProps>) {
  const inputId = useId();
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value);

  return (
    <form
      className="grid gap-3 rounded-surface border border-border bg-surface p-3 shadow-surface md:grid-cols-[minmax(15rem,1fr)_auto] md:items-end"
      onSubmit={handleSubmit}
      role="search"
    >
      <div className="min-w-0">
        <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={inputId}>
          {label}
        </label>
        <div className="relative">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
          <Input
            className="pr-12 pl-11"
            disabled={disabled}
            id={inputId}
            onChange={handleChange}
            placeholder={placeholder}
            type="search"
            value={value}
          />
          {value && onClear ? (
            <button
              aria-label="Xóa nội dung tìm kiếm"
              className="focus-ring ui-transition absolute right-1 top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-muted-foreground transition-colors hover:bg-surface-muted hover:text-ink"
              disabled={disabled}
              onClick={onClear}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="m7 7 10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      {children ? <div className="flex flex-wrap items-end gap-3">{children}</div> : null}
    </form>
  );
}
