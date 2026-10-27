import { useState } from 'react';
import { ChevronDown, ChevronUp, GraduationCap, Play, Telescope } from 'lucide-react';
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

/** Avatar and name of a player, heading their column of the summary table. */
function PlayerHead({ name, color }: { name: string; color: 'w' | 'b' }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1" title={name}>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md text-2xl leading-none ring-1',
          color === 'w'
            ? 'bg-[var(--eval-white)] text-[var(--eval-black)] ring-black/15'
            : 'bg-[var(--eval-black)] text-[var(--eval-white)] ring-white/10',
        )}
      >
        {color === 'w' ? '♔' : '♚'}
      </span>
      <span className="sr-only">{color === 'w' ? 'White: ' : 'Black: '}</span>
      <span className="block w-full truncate text-center text-xs font-semibold">{name}</span>
    </span>
  );
}

/** A player's accuracy: White's in a light box, Black's in a dark one. */
function AccuracyBox({ color, player }: { color: 'w' | 'b'; player: PlayerReview | null }) {
  // A player without reviewed moves has no meaningful accuracy yet.
  const value = player && movesPlayed(player) > 0 ? formatAccuracy(player.accuracy) : '—';
  return (
    <span
      className={cn(
        'tabular block rounded-lg py-2 text-center text-lg leading-tight font-extrabold tracking-tight ring-1 sm:text-xl',
        color === 'w'
          ? 'bg-[var(--eval-white)] text-[#1c1b19] ring-black/15'
          : 'bg-[var(--eval-black)] text-[#ffffff] ring-white/10',
      )}
    >
      {value}
    </span>
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
  /** Number of moves "Learn from your mistakes" would go through. */
  learnCount?: number;
  /** Whose mistakes: the player's own (a perspective is known) or both players'. */
  learnScope?: 'yours' | 'both';
  onLearn?: () => void;
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
  learnCount = 0,
  learnScope = 'yours',
  onLearn,
  className,
}: SummaryCardProps) {
  const [showAll, setShowAll] = useState(false);
  const reviewed = review?.moves.length ?? 0;
  const partial = reviewed < totalPlies;
  const rows = review ? visibleClassifications(review.white, review.black, showAll) : [];

  return (
    <Card className={cn('flex flex-col gap-4 p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="shrink-0 text-base font-bold">Game summary</h2>
        <span className="min-w-0 truncate text-xs text-muted">
          {partial && review ? `${reviewed} of ${totalPlies} moves so far` : engineLabel}
        </span>
      </div>

      <div>
        {/* Side by side: label, White's count, the icon, Black's count. */}
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Accuracy and moves by classification</caption>
          <colgroup>
            <col />
            <col className="w-[4.25rem] sm:w-24" />
            <col className="w-9" />
            <col className="w-[4.25rem] sm:w-24" />
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="pb-2 text-left align-bottom text-xs font-semibold text-muted"
              >
                Players
              </th>
              <th scope="col" className="pb-2 font-normal">
                <PlayerHead name={record.white.name} color="w" />
              </th>
              <td />
              <th scope="col" className="pb-2 font-normal">
                <PlayerHead name={record.black.name} color="b" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="py-1 text-left font-semibold text-muted">
                Accuracy
              </th>
              <td className="py-1">
                <AccuracyBox color="w" player={review?.white ?? null} />
              </td>
              <td />
              <td className="py-1">
                <AccuracyBox color="b" player={review?.black ?? null} />
              </td>
            </tr>
          </tbody>
          {review && (
            <tbody className="border-t border-line">
              {rows.map((classification, index) => {
                const meta = CLASSIFICATION_META[classification];
                const cell = index === 0 ? 'pt-2.5 pb-[3px]' : 'py-[3px]';
                return (
                  <tr key={classification}>
                    <th scope="row" className={cn(cell, 'truncate text-left font-semibold')}>
                      {meta.label}
                    </th>
                    <CountCell
                      value={review.white.counts[classification]}
                      color={meta.colorVar}
                      className={cell}
                    />
                    <td className={cell}>
                      <span className="flex justify-center">
                        <ClassificationIcon classification={classification} size={20} decorative />
                      </span>
                    </td>
                    <CountCell
                      value={review.black.counts[classification]}
                      color={meta.colorVar}
                      className={cell}
                    />
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {review && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            className="mt-1 inline-flex min-h-10 items-center gap-1 rounded-md pr-2 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8"
          >
            {showAll ? (
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {showAll ? 'Show fewer' : 'Show all classifications'}
          </button>
        )}
      </div>

      {!review &&
        (reviewFailed ? (
          <p className="text-sm text-danger" role="alert">
            The move ratings could not be calculated for this game. This is a bug in Chess Yes:
            please report it together with the link to this page.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Accuracy and move ratings appear here as soon as the first moves are analysed.
          </p>
        ))}

      {(atStart || canAnalyseDeeper) && (
        <div className="flex flex-col gap-2">
          {atStart && totalPlies > 0 && (
            <Button variant="primary" size="xl" onClick={onStart} className="w-full">
              <Play aria-hidden="true" className="h-5 w-5 fill-current" />
              Start review
            </Button>
          )}
          {canAnalyseDeeper && (
            <Button
              variant="secondary"
              onClick={onAnalyseDeeper}
              className="w-full"
              title="Re-analyse this game at a greater depth"
            >
              <Telescope aria-hidden="true" className="h-4 w-4" />
              Analyse deeper
            </Button>
          )}
        </div>
      )}

      {onLearn && learnCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <GraduationCap aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Learn from your mistakes</p>
            <p className="text-xs text-muted">
              {learnCount} {learnCount === 1 ? 'move' : 'moves'} to retry
              {learnScope === 'both' ? ', both players' : ''}
            </p>
          </div>
          <Button size="sm" onClick={onLearn} className="h-10 shrink-0 sm:h-8">
            Start
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A player's count of one classification, in its colour (muted when zero). */
function CountCell({
  value,
  color,
  className,
}: {
  value: number;
  color: string;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'tabular text-center text-base font-bold',
        value === 0 && 'font-normal text-muted',
        className,
      )}
      style={value === 0 ? undefined : { color }}
    >
      {value}
    </td>
  );
}
