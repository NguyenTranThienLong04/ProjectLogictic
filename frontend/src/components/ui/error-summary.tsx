import { useEffect, useRef } from 'react';

interface ErrorSummaryProps {
  message?: string;
}

export function ErrorSummary({ message }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  if (!message) return null;

  return (
    <div
      className="rounded-surface border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-900 outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      {message}
    </div>
  );
}
