import { Clock } from 'lucide-react';
import type { Color, PlayerInfo } from '@/core/types';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface PlayerStripProps {
  player: PlayerInfo;
  color: Color;
  /** Seconds left at the current ply, if the game has clocks. */
  clock?: number;
  /** This player is to move in the position shown. */
  toMove: boolean;
  className?: string;
}

/** Name, rating and clock of one player, shown above or below the board. */
export function PlayerStrip({ player, color, clock, toMove, className }: PlayerStripProps) {
  return (
    <div className={cn('flex min-h-9 items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-sm',
            color === 'w'
              ? 'bg-[var(--eval-white)] text-[var(--eval-black)]'
              : 'bg-[var(--eval-black)] text-[var(--eval-white)]',
          )}
        >
          {color === 'w' ? '♔' : '♚'}
        </span>
        {player.title && (
          <span className="rounded bg-accent/15 px-1 text-xs font-bold text-accent">
            {player.title}
          </span>
        )}
        <span className="truncate text-sm font-semibold">{player.name}</span>
        {player.rating !== undefined && (
          <span className="tabular shrink-0 text-sm text-muted">{player.rating}</span>
        )}
        <span className="sr-only">{color === 'w' ? 'White' : 'Black'}</span>
      </div>
      {clock !== undefined && (
        <span
          className={cn(
            'tabular inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-sm',
            toMove ? 'bg-text text-bg' : 'bg-surface-2 text-muted',
          )}
          aria-label={`Clock ${formatClock(clock)}`}
        >
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          {formatClock(clock)}
        </span>
      )}
    </div>
  );
}
