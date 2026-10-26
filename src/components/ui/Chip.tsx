import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pressed state for filter chips (exposed as aria-pressed). */
  selected?: boolean;
}

/** Rounded pill button, used for filters and quick actions. */
export function Chip({ selected, className, type = 'button', ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors sm:h-8',
        selected
          ? 'border-accent/60 bg-accent/15 text-text'
          : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-text',
        className,
      )}
      {...props}
    />
  );
}
