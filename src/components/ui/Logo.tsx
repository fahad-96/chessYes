import { cn } from '@/lib/cn';

/**
 * The Chess Yes mark: a speech bubble with "!?" (the annotation for an interesting
 * move), because kibitzing means commenting on a game you are watching.
 * Same drawing as public/favicon.svg, but coloured with theme tokens.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M14 16h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H30l-10 8v-8h-6a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z"
        fill="var(--accent-fg)"
      />
      <path
        d="M25 22h4l-.8 12h-2.4zM27 36.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM36 26.5c0-3 2.4-4.8 5.3-4.8 3 0 5.2 1.8 5.2 4.4 0 2-1.1 3-2.6 4-1.2.8-1.6 1.3-1.6 2.6v.8h-3.4v-1c0-2 .7-3 2.2-4 1.2-.8 1.8-1.3 1.8-2.3 0-1-.8-1.7-1.7-1.7-1.1 0-1.9.8-1.9 2zM40.6 36.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z"
        fill="var(--accent)"
      />
    </svg>
  );
}

/** Mark plus the "Chess Yes" wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-bold tracking-tight text-text">Chess Yes</span>
    </span>
  );
}
