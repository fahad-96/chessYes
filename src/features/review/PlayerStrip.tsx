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
  const white = color === 'w';
  return (
    <div className={cn('flex min-h-9 items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xl leading-none ring-1',
            white
              ? 'bg-[var(--eval-white)] text-[var(--eval-black)] ring-black/15'
              : 'bg-[var(--eval-black)] text-[var(--eval-white)] ring-white/10',
          )}
        >
          {white ? '♔' : '♚'}
        </span>
        {player.title && (
          <span className="rounded bg-accent/15 px-1 text-xs font-bold text-accent">
            {player.title}
          </span>
        )}
        <span className="truncate text-sm font-bold">{player.name}</span>
        {player.rating !== undefined && (
          <span className="tabular shrink-0 text-sm text-muted">({player.rating})</span>
        )}
        <span className="sr-only">{white ? 'White' : 'Black'}</span>
      </div>
      {clock !== undefined && (
        // The clock box is in the player's colour; the side to move has the bright one.
        <span
          className={cn(
            'tabular inline-flex min-w-[5.5rem] shrink-0 items-center justify-end gap-1.5 rounded-md px-2.5 py-1 font-mono text-base font-bold ring-1 transition-opacity',
            white
              ? 'bg-[var(--eval-white)] text-[#1c1b19] ring-black/15'
              : 'bg-[var(--eval-black)] text-[#ffffff] ring-white/10',
            !toMove && 'opacity-60',
          )}
          aria-label={`Clock ${formatClock(clock)}`}
        >
          {toMove && <Clock aria-hidden="true" className="h-3.5 w-3.5" />}
          {formatClock(clock)}
        </span>
      )}
    </div>
  );
}
