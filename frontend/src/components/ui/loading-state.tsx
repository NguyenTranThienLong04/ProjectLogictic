interface LoadingStateProps {
  label?: string;
  compact?: boolean;
}

export function LoadingState({ label = 'Đang tải dữ liệu', compact = false }: LoadingStateProps) {
  return (
    <div
      aria-live="polite"
      className={`grid place-items-center ${compact ? 'min-h-24' : 'min-h-64'}`}
      role="status"
    >
      <div className="text-center">
        <svg
          aria-hidden="true"
          className="mx-auto size-7 text-primary motion-safe:animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-20"
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
        <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
