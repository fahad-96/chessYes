import { memo } from 'react';
import type { Score } from '@/core/types';
import { formatScore, scoreToWinPercent } from '@/core/winPercent';
import { cn } from '@/lib/cn';
import type { BoardOrientation } from './Board';

/**
 * What the bar shows: a live engine score, or the final state of a finished game
 * (checkmate fills the bar, any draw sits at 50%).
 */
export type EvalBarValue =
  { kind: 'score'; score: Score } | { kind: 'final'; whiteWinPercent: number; label: string };

/** White's share of the bar, 0-100. A forced mate fills the bar completely. */
export function evalBarFill(value: EvalBarValue | null): number {
  if (!value) return 50;
  if (value.kind === 'final') return clampPercent(value.whiteWinPercent);
  if (value.score.type === 'mate') return value.score.value > 0 ? 100 : 0;
  return clampPercent(scoreToWinPercent(value.score));
}

/** Text inside the bar: the score without its sign (the side of the bar shows who is ahead). */
export function evalBarLabel(value: EvalBarValue | null): string {
  if (!value) return '';
  if (value.kind === 'final') return value.label;
  return formatScore(value.score).replace(/^[+-]/, '');
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export interface EvalBarProps {
  /** null while the position has not been analysed yet. */
  value: EvalBarValue | null;
  orientation: BoardOrientation;
  /** Hide the score text, e.g. when the bar is too thin to fit it. Default true. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Slim vertical evaluation bar. White's part grows from White's side of the board,
 * so the bar flips together with the board. The parent sizes it (e.g. a stretched
 * flex item next to the board).
 */
export const EvalBar = memo(function EvalBar({
  value,
  orientation,
  showLabel = true,
  className,
}: EvalBarProps) {
  const fill = evalBarFill(value);
  const label = evalBarLabel(value);
  const whiteAhead = fill >= 50;
  const whiteAtBottom = orientation === 'white';
  // The label sits at the end of the bar that belongs to the side that is ahead.
  const labelAtBottom = whiteAhead === whiteAtBottom;
  const description = value ? `Evaluation ${formatAccessible(value)}` : 'Evaluation pending';

  return (
    <div
      role="img"
      aria-label={description}
      className={cn(
        'relative overflow-hidden rounded-md bg-[var(--eval-black)] ring-1 ring-line select-none',
        !value && 'opacity-60',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 bg-[var(--eval-white)] transition-[height] duration-300 ease-out',
          whiteAtBottom ? 'bottom-0' : 'top-0',
        )}
        style={{ height: `${fill}%` }}
      />
      {/* Midline marks equality. */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--muted)] opacity-40" />
      {showLabel && label && (
        <span
          className={cn(
            'tabular absolute inset-x-0 text-center text-[9px] leading-none font-bold sm:text-[10px]',
            labelAtBottom ? 'bottom-1' : 'top-1',
            whiteAhead ? 'text-[var(--eval-black)]' : 'text-[var(--eval-white)]',
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
});

function formatAccessible(value: EvalBarValue): string {
  return value.kind === 'final' ? value.label : formatScore(value.score);
}
