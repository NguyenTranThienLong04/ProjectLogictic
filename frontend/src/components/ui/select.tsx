import { forwardRef } from 'react';
import type { PropsWithChildren, SelectHTMLAttributes } from 'react';

export const selectClassName =
  'focus-ring ui-transition min-h-12 w-full cursor-pointer rounded-control border border-border bg-surface px-3.5 text-base text-ink shadow-surface outline-none transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground aria-invalid:border-danger aria-invalid:bg-red-50';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, PropsWithChildren<SelectProps>>(function Select(
  { children, className = '', invalid, ...props },
  ref,
) {
  const ariaInvalid = invalid || props['aria-invalid'] || undefined;
  return (
    <select
      {...props}
      aria-invalid={ariaInvalid}
      className={`${selectClassName} ${className}`}
      ref={ref}
    >
      {children}
    </select>
  );
});
