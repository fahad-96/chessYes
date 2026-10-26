import { memo, useEffect, useRef } from 'react';
import type { Classification, Color } from '@/core/types';
import { cn } from '@/lib/cn';
import { ClassificationIcon } from './ClassificationIcon';
import { CLASSIFICATION_META } from './classificationMeta';

export interface MoveListItem {
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
}

export interface MovePair<T extends MoveListItem = MoveListItem> {
  moveNumber: number;
  white?: T;
  black?: T;
}

/** Groups half-moves into numbered rows. A game starting with Black gets an empty White cell. */
export function groupMovePairs<T extends MoveListItem>(moves: readonly T[]): MovePair<T>[] {
  const rows: MovePair<T>[] = [];
  for (const move of moves) {
    const last = rows[rows.length - 1];
    if (move.color === 'b' && last && last.moveNumber === move.moveNumber && !last.black) {
      last.black = move;
    } else if (move.color === 'w') {
      rows.push({ moveNumber: move.moveNumber, white: move });
    } else {
      rows.push({ moveNumber: move.moveNumber, black: move });
    }
  }
  return rows;
}

export interface MoveListProps {
  moves: readonly MoveListItem[];
  /** Classification per move; index = ply - 1. Missing entries are shown without a badge. */
  classifications: readonly (Classification | undefined)[];
  currentPly: number;
  onSelect: (ply: number) => void;
  /** Moves from this ply on are not analysed yet and look pending. */
  pendingFromPly?: number;
  className?: string;
}

/**
 * Numbered move list. Keeps the current move scrolled into view inside its own
 * scroll area (never scrolls the page).
 */
export const MoveList = memo(function MoveList({
  moves,
  classifications,
  currentPly,
  onSelect,
  pendingFromPly = Number.POSITIVE_INFINITY,
  className,
}: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const rows = groupMovePairs(moves);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-ply="${currentPly}"]`);
    const margin = 8;
    let top: number | null = null;
    if (!target) {
      top = 0;
    } else if (target.offsetTop < container.scrollTop + margin) {
      top = target.offsetTop - margin;
    } else if (
      target.offsetTop + target.offsetHeight >
      container.scrollTop + container.clientHeight - margin
    ) {
      top = target.offsetTop + target.offsetHeight - container.clientHeight + margin;
    }
    if (top === null || top === container.scrollTop) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      container.scrollTop = Math.max(0, top);
    }
  }, [currentPly]);

  const renderMove = (move: MoveListItem | undefined) => {
    if (!move) return <span className="px-2 text-muted">…</span>;
    const classification = classifications[move.ply - 1];
    const pending = move.ply >= pendingFromPly;
    const current = move.ply === currentPly;
    const label = classification
      ? `${move.san}, ${CLASSIFICATION_META[classification].label}`
      : pending
        ? `${move.san}, not analysed yet`
        : move.san;
    return (
      <button
        type="button"
        data-ply={move.ply}
        aria-current={current ? 'step' : undefined}
        aria-label={label}
        onClick={() => onSelect(move.ply)}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm lg:py-1',
          'transition-colors focus-visible:outline-2 focus-visible:outline-accent',
          current ? 'bg-surface-3 font-semibold text-text' : 'hover:bg-surface-2',
          pending && !current && 'text-muted/70',
        )}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {classification ? (
            <ClassificationIcon classification={classification} size={14} decorative />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-line" />
          )}
        </span>
        <span className="truncate">{move.san}</span>
      </button>
    );
  };

  return (
    <div
      ref={listRef}
      className={cn('relative overflow-y-auto overscroll-contain', className)}
      aria-label="Moves"
    >
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No moves in this game.</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((row, index) => (
            <li
              key={`${row.moveNumber}-${index}`}
              className={cn(
                'grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1 px-1 py-0.5',
                index % 2 === 1 && 'bg-surface-2/40',
              )}
            >
              <span className="tabular pr-1 text-right text-xs text-muted">{row.moveNumber}.</span>
              {renderMove(row.white)}
              {row.black ? renderMove(row.black) : <span />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
