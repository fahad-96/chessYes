import { Square, Volume2 } from 'lucide-react';
import type { GameReview, ParsedMove } from '@/core/types';
import { moveNumberLabel } from '@/core/notation';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export interface KeyMomentsProps {
  review: GameReview | null;
  moves: readonly ParsedMove[];
  currentPly: number;
  onSelect: (ply: number) => void;
  /** Starts "Narrate key moments" (given only when the browser can speak). */
  onNarrate?: () => void;
  /** The key moments are being narrated: the button stops it. */
  narrating?: boolean;
  onStopNarrating?: () => void;
  className?: string;
}

/** Chips for the most instructive moments of the game. */
export function KeyMoments({
  review,
  moves,
  currentPly,
  onSelect,
  onNarrate,
  narrating = false,
  onStopNarrating,
  className,
}: KeyMomentsProps) {
  const moments = (review?.keyMoments ?? [])
    .map((ply) => ({ ply, move: moves[ply - 1], moveReview: review?.moves[ply - 1] }))
    .filter((m) => m.move && m.moveReview);
  if (moments.length === 0) return null;

  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Key moments</h2>
        {narrating && onStopNarrating ? (
          <button
            type="button"
            onClick={onStopNarrating}
            className="-my-2 -mr-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Square aria-hidden="true" className="h-3 w-3 fill-current" />
            Stop narrating
          </button>
        ) : (
          onNarrate && (
            <button
              type="button"
              onClick={onNarrate}
              className="-my-2 -mr-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
              Narrate key moments
            </button>
          )
        )}
      </div>
      <ul className="flex flex-wrap gap-2">
        {moments.map(({ ply, move, moveReview }) => {
          if (!move || !moveReview) return null;
          const meta = CLASSIFICATION_META[moveReview.classification];
          const active = ply === currentPly;
          return (
            <li key={ply}>
              <button
                type="button"
                onClick={() => onSelect(ply)}
                aria-current={active ? 'step' : undefined}
                aria-label={`${moveNumberLabel(move.moveNumber, move.color)} ${move.san}, ${meta.label}`}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors lg:min-h-0',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  active
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-line bg-surface-2 hover:bg-surface-3',
                )}
              >
                <ClassificationIcon
                  classification={moveReview.classification}
                  size={16}
                  decorative
                />
                <span className="tabular text-muted">
                  {moveNumberLabel(move.moveNumber, move.color)}
                </span>
                <span className="font-semibold">{move.san}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
