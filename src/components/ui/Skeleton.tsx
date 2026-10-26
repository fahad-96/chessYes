import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Pulsing placeholder block shown while content loads. Size it with classes. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-3', className)}
      {...props}
    />
  );
}
