interface StatusDotProps {
  label: string;
}

export function StatusDot({ label }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800">
      <span className="relative flex size-2.5" aria-hidden="true">
        <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-50 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-600" />
      </span>
      {label}
    </span>
  );
}
