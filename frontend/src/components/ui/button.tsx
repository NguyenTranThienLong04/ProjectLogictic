import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'attention' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variants = {
  primary:
    'border border-primary bg-primary text-on-primary shadow-surface hover:border-primary-strong hover:bg-primary-strong active:bg-primary-strong',
  secondary:
    'border border-border-strong bg-surface text-primary shadow-surface hover:border-primary hover:bg-primary-soft active:bg-blue-100',
  attention:
    'border border-accent bg-accent text-on-accent shadow-surface hover:border-accent-strong hover:bg-accent-strong hover:text-white active:bg-accent-strong active:text-white',
  danger:
    'border border-danger bg-danger text-white shadow-surface hover:border-danger-strong hover:bg-danger-strong active:bg-danger-strong',
  ghost:
    'border border-transparent bg-transparent text-muted-foreground hover:bg-surface-muted hover:text-ink active:bg-slate-200',
} as const;

const sizes = {
  sm: 'min-h-10 px-3 text-sm',
  md: 'min-h-12 px-4 text-sm sm:px-5',
  lg: 'min-h-12 px-5 text-base sm:min-h-13 sm:px-6',
} as const;

export function Button({
  children,
  className = '',
  disabled,
  loading = false,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      aria-busy={loading || undefined}
      className={`focus-ring ui-transition inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? (
        <svg
          aria-hidden="true"
          className="size-5 motion-safe:animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-80"
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
