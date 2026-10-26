import type { Square } from '@/core/types';
import { cn } from '@/lib/cn';
import type { BoardOrientation } from './Board';
import { squareCell } from './boardGeometry';

export interface SquareHighlightProps {
  square: Square;
  orientation: BoardOrientation;
  /** Read out to screen readers, e.g. "Hint: the knight on f3". */
  label?: string;
  className?: string;
}

/**
 * A pulsing ring around one square, drawn over a <Board> (place both in a `relative`
 * wrapper). It never takes pointer input, so the board below stays fully interactive.
 */
export function SquareHighlight({ square, orientation, label, className }: SquareHighlightProps) {
  const { column, row } = squareCell(square, orientation);
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)}>
      <div
        className="absolute h-[12.5%] w-[12.5%] p-[0.4%]"
        style={{ left: `${column * 12.5}%`, top: `${row * 12.5}%` }}
      >
        <div className="h-full w-full animate-pulse rounded-[18%] bg-accent/25 shadow-[inset_0_0_0_3px_var(--accent)]" />
      </div>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
