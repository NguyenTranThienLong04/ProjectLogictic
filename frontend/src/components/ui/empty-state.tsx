import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ action, compact = false, description, icon, title }: EmptyStateProps) {
  return (
    <section
      className={`rounded-surface border border-dashed border-border-strong bg-surface text-center ${compact ? 'p-5' : 'px-5 py-10 sm:px-8'}`}
    >
      <div
        aria-hidden="true"
        className="mx-auto grid size-11 place-items-center rounded-full bg-primary-soft text-primary"
      >
        {icon ?? (
          <svg
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5v-9Z" />
            <path d="m5 7.5 7 3.5 7-3.5M12 11v9" />
          </svg>
        )}
      </div>
      <h2 className="mt-3 text-base font-semibold text-ink sm:text-lg">{title}</h2>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}
