import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { GameRecord, GameReview, PlayerInfo } from '@/core/types';
import { formatGameDate, formatTimeClass, formatTimeControl } from '@/lib/format';
import { cn } from '@/lib/cn';
import { resultLabel } from './reviewHelpers';

function PlayerName({ player, color }: { player: PlayerInfo; color: 'w' | 'b' }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full border border-line',
          color === 'w' ? 'bg-[var(--eval-white)]' : 'bg-[var(--eval-black)]',
        )}
      />
      {player.title && (
        <span className="rounded bg-accent/15 px-1 text-xs font-bold text-accent">
          {player.title}
        </span>
      )}
      <span className="truncate">{player.name}</span>
      {player.rating !== undefined && (
        <span className="tabular text-sm font-normal text-muted">({player.rating})</span>
      )}
    </span>
  );
}

export interface ReviewHeaderProps {
  record: GameRecord;
  review: GameReview | null;
  /** Phone layout: one line of details (the player strips already show names and ratings). */
  compact?: boolean;
  /** Buttons at the end of the title row, e.g. the Share menu. */
  actions?: ReactNode;
}

function OriginalGameLink({ url, short }: { url: string; short: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={short ? 'View original game' : undefined}
      className="inline-flex shrink-0 items-center gap-1 text-text underline-offset-2 hover:text-accent hover:underline"
    >
      {short ? 'Original' : 'View original game'}
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}

/** Players, result and game details above the board. */
export function ReviewHeader({ record, review, compact = false, actions }: ReviewHeaderProps) {
  const opening =
    review?.opening ??
    (record.openingName ? { eco: record.eco ?? '', name: record.openingName } : null);
  const timeControl = formatTimeControl(record.timeControl);
  const details = [
    record.termination,
    opening ? [opening.eco, opening.name].filter(Boolean).join(' ') : undefined,
    [timeControl, record.timeClass !== 'unknown' ? formatTimeClass(record.timeClass) : '']
      .filter(Boolean)
      .join(' '),
    formatGameDate(record.endTime),
  ].filter((item): item is string => !!item);
  const result = (
    <span className="tabular shrink-0 rounded-md border border-line bg-surface-2 px-2 py-0.5 text-sm font-semibold">
      {resultLabel(record.result)}
    </span>
  );

  if (compact) {
    return (
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 truncate text-base font-semibold">
            {record.white.name} <span className="font-normal text-muted">vs</span>{' '}
            {record.black.name}
          </h1>
          {result}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span className="min-w-0 truncate" title={details.join(' · ')}>
            {details.join(' · ')}
          </span>
          {record.url && <OriginalGameLink url={record.url} short />}
        </p>
      </header>
    );
  }

  return (
    <header className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
          <PlayerName player={record.white} color="w" />
          <span className="text-sm font-normal text-muted">vs</span>
          <PlayerName player={record.black} color="b" />
        </h1>
        {result}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
        {details.map((item, index) => (
          <span key={index} className="inline-flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">·</span>}
            {item}
          </span>
        ))}
        {record.url && (
          <span className="inline-flex items-center gap-2">
            {details.length > 0 && <span aria-hidden="true">·</span>}
            <OriginalGameLink url={record.url} short={false} />
          </span>
        )}
      </p>
    </header>
  );
}
