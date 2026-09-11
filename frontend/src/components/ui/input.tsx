import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export const inputClassName =
  'focus-ring ui-transition min-h-12 w-full rounded-control border border-border bg-surface px-3.5 text-base text-ink shadow-surface outline-none transition-colors placeholder:text-slate-400 hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground aria-invalid:border-danger aria-invalid:bg-red-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', invalid, ...props },
  ref,
) {
  const ariaInvalid = invalid || props['aria-invalid'] || undefined;
  return (
    <input
      {...props}
      aria-invalid={ariaInvalid}
      className={`${inputClassName} ${className}`}
      ref={ref}
    />
  );
});
