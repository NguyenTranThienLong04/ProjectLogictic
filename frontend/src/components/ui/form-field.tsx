import type { InputHTMLAttributes } from 'react';
import { inputClassName } from './input';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  helperText?: string;
  label: string;
}

export function FormField({ className = '', error, helperText, id, label, ...props }: FormFieldProps) {
  const describedBy = [helperText ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error)}
        className={`${inputClassName} ${className}`}
        id={id}
        {...props}
      />
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
