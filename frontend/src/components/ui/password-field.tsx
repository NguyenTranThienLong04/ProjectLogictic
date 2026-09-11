import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { inputClassName } from './input';

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  error?: string;
  helperText?: string;
  label: string;
}

export function PasswordField({ className = '', error, helperText, id, label, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const describedBy = [helperText ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          className={`${inputClassName} py-3 pr-14 pl-3.5 ${className}`}
          id={id}
          type={visible ? 'text' : 'password'}
          {...props}
        />
        <button
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="focus-ring ui-transition absolute inset-y-0 right-1 my-auto grid size-11 cursor-pointer place-items-center rounded-control text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            {visible ? (
              <>
                <path d="m3 3 18 18" />
                <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5.2 9 5.2a15 15 0 0 1-2.2 2.7M6.6 6.6A15.4 15.4 0 0 0 3 9.2S6.5 14.5 12 14.5c.8 0 1.6-.1 2.3-.3" />
              </>
            ) : (
              <>
                <path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12Z" />
                <circle cx="12" cy="12" r="2.3" />
              </>
            )}
          </svg>
        </button>
      </div>
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
