import { cn } from '@/lib/cn';
import type { ResultCounts } from './stats';

const SEGMENTS = [
  { key: 'wins', label: 'won', className: 'bg-success' },
  { key: 'draws', label: 'drawn', className: 'bg-muted/45' },
  { key: 'losses', label: 'lost', className: 'bg-danger' },
] as const;

export interface WdlBarProps {
  results: ResultCounts;
  /** Show "12 / 3 / 5" under the bar. */
  showCounts?: boolean;
  className?: string;
}

/**
 * Wins, draws and losses as one bar: wins always on the left, losses on the right, with a
 * 2px gap between segments, so the order (and the counts next to it) carry the meaning
 * for colour-blind readers too.
 */
export function WdlBar({ results, showCounts = false, className }: WdlBarProps) {
  const { games } = results;
  const label = `${results.wins} won, ${results.draws} drawn, ${results.losses} lost`;
  return (
    <div className={cn('min-w-0', className)}>
      <div role="img" aria-label={label} title={label} className="flex h-2 gap-[2px]">
        {games === 0 ? (
          <span className="h-full flex-1 rounded-full bg-surface-3" />
        ) : (
          SEGMENTS.filter((s) => results[s.key] > 0).map((segment) => (
            <span
              key={segment.key}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', segment.className)}
              style={{ flexGrow: results[segment.key], flexBasis: 0, minWidth: 3 }}
            />
          ))
        )}
      </div>
      {showCounts && (
        <p className="tabular mt-1 text-xs text-muted" aria-hidden="true">
          <span className="text-text">{results.wins}</span>W · {results.draws}D ·{' '}
          <span className="text-text">{results.losses}</span>L
        </p>
      )}
    </div>
  );
}
