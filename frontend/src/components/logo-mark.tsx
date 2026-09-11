interface LogoMarkProps {
  className?: string;
}

export function LogoMark({ className = 'size-9' }: LogoMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path
        d="M10.5 13.5h12v9h-12v-9Zm12 3h4.4l3.1 3.8v2.2h-7.5v-6Zm-8.5 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12.5 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        fill="white"
      />
    </svg>
  );
}
