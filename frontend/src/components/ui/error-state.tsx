import { Button } from './button';

interface ErrorStateProps {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({
  compact = false,
  message,
  onRetry,
  retryLabel = 'Thử lại',
  title = 'Không thể tải dữ liệu',
}: ErrorStateProps) {
  return (
    <section
      className={`rounded-surface border border-red-200 bg-red-50 text-center ${compact ? 'p-4' : 'px-5 py-8 sm:px-8'}`}
      role="alert"
    >
      <div
        aria-hidden="true"
        className="mx-auto grid size-11 place-items-center rounded-full bg-danger-soft text-danger"
      >
        <svg
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 8v5m0 3.5v.5" />
          <path d="M10.3 4.4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h2 className="mt-3 text-base font-semibold text-red-950 sm:text-lg">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-red-800">{message}</p>
      {onRetry ? (
        <Button className="mt-5" onClick={onRetry} variant="secondary">
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
}
