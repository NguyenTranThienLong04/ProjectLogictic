import type { PropsWithChildren, SelectHTMLAttributes } from 'react';
import { selectClassName } from './select';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  helperText?: string;
  label: string;
}

export function SelectField({
  children,
  className = '',
  error,
  helperText,
  id,
  label,
  ...props
}: PropsWithChildren<SelectFieldProps>) {
  const describedBy = [helperText ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={id}>
        {label}
      </label>
      <select
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error)}
        className={`${selectClassName} ${className}`}
        id={id}
        {...props}
      >
        {children}
      </select>
      {helperText ? (
        <p className="mt-1.5 text-sm leading-5 text-muted-foreground" id={`${id}-help`}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-sm font-semibold text-danger" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
