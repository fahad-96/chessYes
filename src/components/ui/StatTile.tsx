import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatTileProps {
  /** Sentence-case label, e.g. "Score". */
  label: ReactNode;
  /** The headline value. */
  value: ReactNode;
  /** A short line under the value, e.g. "120 games". */
  detail?: ReactNode;
  /** Extra content under the detail (a small bar, a delta). */
  children?: ReactNode;
  className?: string;
}

/** A labelled headline number on a tinted tile, for rows of key figures. */
export function StatTile({ label, value, detail, children, className }: StatTileProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-xl bg-surface-2 px-3 py-3', className)}>
      {/* Labels wrap rather than truncate: a cut-off label hides what the number means. */}
      <span className="text-xs break-words text-muted">{label}</span>
      {/* Proportional figures: tabular digits look loose at this size. */}
      <span className="text-2xl leading-tight font-bold tracking-tight">{value}</span>
      {detail && <span className="text-xs text-muted">{detail}</span>}
      {children}
    </div>
  );
}
