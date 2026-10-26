import { useState } from 'react';
import { ChevronDown, ChevronUp, Play, Telescope } from 'lucide-react';
import { CLASSIFICATIONS } from '@/core/types';
import type { Classification, GameRecord, GameReview, PlayerReview } from '@/core/types';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { CLASSIFICATION_META } from '@/components/classificationMeta';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatAccuracy } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Rows of the counts table: every classification either player got, or all of them. */
export function visibleClassifications(
  white: PlayerReview,
  black: PlayerReview,
  showAll: boolean,
): Classification[] {
  if (showAll) return [...CLASSIFICATIONS];
  return CLASSIFICATIONS.filter((c) => white.counts[c] + black.counts[c] > 0);
}

function movesPlayed(player: PlayerReview): number {
  return CLASSIFICATIONS.reduce((sum, c) => sum + player.counts[c], 0);
}

function AccuracyTile({
  name,
  color,
  player,
}: {
  name: string;
  color: 'w' | 'b';
  player: PlayerReview | null;
}) {
  // A player without reviewed moves has no meaningful accuracy yet.
  const value = player && movesPlayed(player) > 0 ? formatAccuracy(player.accuracy) : '—';
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <span
          aria-hidden="true"
          className={cn(
            'h-2 w-2 shrink-0 rounded-full border border-line',
            color === 'w' ? 'bg-[var(--eval-white)]' : 'bg-[var(--eval-black)]',
          )}
        />
        <span className="truncate">{name}</span>
      </span>
      <span className="tabular text-3xl leading-none font-bold tracking-tight">{value}</span>
      <span className="text-xs text-muted">Accuracy</span>
    </div>
  );
}

export interface SummaryCardProps {
  record: GameRecord;
  review: GameReview | null;
  /** The analyses could not be turned into a review (a bug); explains instead of waiting. */
  reviewFailed?: boolean;
  totalPlies: number;
  /** Shows the "Start review" button (at the start position). */
  atStart: boolean;
  onStart: () => void;
  canAnalyseDeeper: boolean;
  onAnalyseDeeper: () => void;
  engineLabel: string;
  className?: string;
}

/** Both players' accuracy and how many moves of each kind they played. */
export function SummaryCard({
  record,
  review,
  reviewFailed = false,
  totalPlies,
  atStart,
  onStart,
  canAnalyseDeeper,
  onAnalyseDeeper,
  engineLabel,
  className,
}: SummaryCardProps) {
  const [showAll, setShowAll] = useState(false);
  const reviewed = review?.moves.length ?? 0;
  const partial = reviewed < totalPlies;
  const rows = review ? visibleClassifications(review.white, review.black, showAll) : [];

  return (
    <Card className={cn('flex flex-col gap-4 p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Game summary</h2>
        <span className="text-xs text-muted">
          {partial && review ? `${reviewed} of ${totalPlies} moves so far` : engineLabel}
        </span>
      </div>

      <div className="flex gap-2">
        <AccuracyTile name={record.white.name} color="w" player={review?.white ?? null} />
        <AccuracyTile name={record.black.name} color="b" player={review?.black ?? null} />
      </div>

      {review ? (
        <div>
          <table className="w-full text-sm">
            <caption className="sr-only">Moves by classification</caption>
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="pb-1 text-left font-medium">
                  Move quality
                </th>
                <th scope="col" className="w-14 pb-1 text-right font-medium">
                  White
                </th>
                <th scope="col" className="w-14 pb-1 text-right font-medium">
                  Black
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((classification) => (
                <tr key={classification} className="border-t border-line/60">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <span className="inline-flex items-center gap-2">
                      <ClassificationIcon classification={classification} size={18} decorative />
                      <span style={{ color: CLASSIFICATION_META[classification].colorVar }}>
                        {CLASSIFICATION_META[classification].label}
                      </span>
                    </span>
                  </th>
                  <CountCell value={review.white.counts[classification]} />
                  <CountCell value={review.black.counts[classification]} />
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            className="mt-2 inline-flex items-center gap-1 rounded-md text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {showAll ? (
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {showAll ? 'Show fewer' : 'Show all classifications'}
          </button>
        </div>
      ) : reviewFailed ? (
        <p className="text-sm text-danger" role="alert">
          The move ratings could not be calculated for this game. This is a bug in Kibitz: please
          report it together with the link to this page.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Accuracy and move ratings appear here as soon as the first moves are analysed.
        </p>
      )}

      {(atStart || canAnalyseDeeper) && (
        <div className="flex flex-wrap gap-2">
          {atStart && totalPlies > 0 && (
            <Button variant="primary" onClick={onStart} className="flex-1">
              <Play aria-hidden="true" className="h-4 w-4" />
              Start review
            </Button>
          )}
          {canAnalyseDeeper && (
            <Button
              variant="secondary"
              onClick={onAnalyseDeeper}
              className={atStart ? undefined : 'flex-1'}
              title="Re-analyse this game at a greater depth"
            >
              <Telescope aria-hidden="true" className="h-4 w-4" />
              Analyse deeper
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function CountCell({ value }: { value: number }) {
  return (
    <td
      className={cn(
        'tabular py-1.5 text-right font-semibold',
        value === 0 && 'font-normal text-muted/60',
      )}
    >
      {value}
    </td>
  );
}
