import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'accent' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  accent: 'bg-accent/15 text-accent',
  outline: 'border border-line text-muted',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small inline label (results, chess titles, statuses). */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
