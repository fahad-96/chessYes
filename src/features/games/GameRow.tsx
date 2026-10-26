import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GameRecord } from '@/core/types';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { formatGameDate, formatTimeClass, formatTimeControl } from '@/lib/format';
import { isReviewable, outcomeForPlayer, reviewPath, sides, type PlayerOutcome } from './gameList';
import { TIME_CLASS_ICONS } from './timeClassIcons';

const OUTCOME_STYLES: Record<PlayerOutcome, { label: string; className: string }> = {
  win: { label: 'Win', className: 'bg-success/15 text-success' },
  loss: { label: 'Loss', className: 'bg-danger/15 text-danger' },
  draw: { label: 'Draw', className: 'bg-surface-3 text-muted' },
  unknown: { label: '—', className: 'bg-surface-3 text-muted' },
};

/** One game in the list. The whole row links to the review; other variants are disabled. */
export function GameRow({ game, username }: { game: GameRecord; username: string }) {
  const outcome = outcomeForPlayer(game, username);
  const { me, opponent, color } = sides(game, username);
  const reviewable = isReviewable(game);
  const TimeIcon = TIME_CLASS_ICONS[game.timeClass];
  const timeControl = formatTimeControl(game.timeControl);
  const date = formatGameDate(game.endTime);
  const pill = OUTCOME_STYLES[outcome];

  const content = (
    <>
      <span
        className={cn(
          'inline-flex h-7 w-12 shrink-0 items-center justify-center rounded-md text-xs font-bold',
          pill.className,
        )}
      >
        {pill.label}
        {outcome === 'unknown' && <span className="sr-only">Result unknown</span>}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-xs text-muted">vs</span>
          {opponent.title && <Badge tone="accent">{opponent.title}</Badge>}
          <span className="truncate font-medium text-text">{opponent.name}</span>
          {opponent.rating !== undefined && (
            <span className="tabular shrink-0 text-sm text-muted">{opponent.rating}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'h-2.5 w-2.5 rounded-full ring-1 ring-line',
                color === 'w' ? 'bg-[var(--eval-white)]' : 'bg-[var(--eval-black)]',
              )}
            />
            <span>{color === 'w' ? 'White' : 'Black'}</span>
            {me.rating !== undefined && <span className="tabular">· {me.rating}</span>}
          </span>
          <span className="inline-flex items-center gap-1" title={formatTimeClass(game.timeClass)}>
            <TimeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{formatTimeClass(game.timeClass)}</span>
            <span className="tabular">{timeControl || formatTimeClass(game.timeClass)}</span>
          </span>
          {game.rated !== undefined && <span>{game.rated ? 'Rated' : 'Casual'}</span>}
          {date && <span className="sm:hidden">{date}</span>}
          {!reviewable && <Badge tone="outline">Variant not supported</Badge>}
        </div>
        {game.openingName && (
          <p className="mt-1 truncate text-xs text-muted md:hidden">{game.openingName}</p>
        )}
      </div>

      <p
        className="hidden w-56 truncate text-sm text-muted md:block lg:w-72"
        title={game.openingName}
      >
        {game.openingName}
      </p>
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted sm:block">{date}</span>
      {reviewable && (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      )}
    </>
  );

  const base = 'flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 sm:px-4';
  if (!reviewable) {
    return (
      <div
        className={cn(base, 'opacity-60')}
        aria-disabled="true"
        title={`${game.variant}: variant not supported`}
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      to={reviewPath(game.id)}
      // The review page can use this to skip refetching the game it was opened from.
      state={{ record: game }}
      className={cn(base, 'group transition-colors hover:border-muted/40 hover:bg-surface-2')}
    >
      {content}
    </Link>
  );
}
