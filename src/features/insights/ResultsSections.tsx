import { useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { GameRecord } from '@/core/types';
import { StatTile } from '@/components/ui/StatTile';
import { reviewPath, sides } from '@/features/games/gameList';
import { TIME_CLASS_ICONS } from '@/features/games/timeClassIcons';
import { cn } from '@/lib/cn';
import { formatTimeClass } from '@/lib/format';
import { LineChart } from './LineChart';
import { Section } from './Section';
import { WdlBar } from './WdlBar';
import { formatAxisDate, formatDay, formatPercent, formatSigned, plural } from './format';
import {
  ENDING_LABELS,
  scorePercent,
  type EndingRow,
  type EndingStats,
  type Overview,
  type ResultCounts,
  type TimeClassStats,
} from './stats';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function OverviewSection({ overview, scope }: { overview: Overview; scope: string }) {
  const { all, white, black } = overview;
  return (
    <Section title="Overview" description={scope}>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatTile label="Games" value={all.games}>
          <WdlBar results={all} showCounts className="mt-1" />
        </StatTile>
        <StatTile
          label="Score"
          value={formatPercent(scorePercent(all))}
          detail="Wins count 1, draws ½"
        />
        <ColourTile label="As White" results={white} />
        <ColourTile label="As Black" results={black} />
      </div>
    </Section>
  );
}

function ColourTile({ label, results }: { label: string; results: ResultCounts }) {
  return (
    <StatTile
      label={label}
      value={formatPercent(scorePercent(results))}
      detail={`Score in ${plural(results.games, 'game')}`}
    >
      <WdlBar results={results} showCounts className="mt-1" />
    </StatTile>
  );
}

// ---------------------------------------------------------------------------
// Time classes and rating
// ---------------------------------------------------------------------------

export function TimeClassSection({
  groups,
  games,
  username,
  showTable,
}: {
  groups: TimeClassStats[];
  games: readonly GameRecord[];
  username: string;
  /** False when a single time class is selected: the table would have one row. */
  showTable: boolean;
}) {
  // The most played time control first; with an odd count it gets the full width.
  const charts = groups
    .filter((group) => group.ratings.length >= 2)
    .sort((a, b) => b.ratings.length - a.ratings.length);
  return (
    <Section
      title={showTable ? 'By time control' : 'Rating'}
      description={
        showTable
          ? 'Results and your rating over these games in each time control.'
          : 'Your rating over these games.'
      }
    >
      {showTable && (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Results by time control</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="pb-2 font-medium">
                  Time control
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Games
                </th>
                <th scope="col" className="hidden w-40 pb-2 pl-4 font-medium sm:table-cell">
                  Results
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Score
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const Icon = TIME_CLASS_ICONS[group.timeClass];
                const first = group.ratings[0]?.rating;
                const last = group.ratings.at(-1)?.rating;
                return (
                  <tr key={group.timeClass} className="border-t border-line/60">
                    <th scope="row" className="py-2.5 pr-2 text-left font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
                        {formatTimeClass(group.timeClass)}
                      </span>
                      <WdlBar results={group.results} className="mt-1.5 w-24 sm:hidden" />
                    </th>
                    <td className="tabular py-2.5 pl-3 text-right">{group.results.games}</td>
                    <td className="hidden py-2.5 pl-4 sm:table-cell">
                      <WdlBar results={group.results} />
                    </td>
                    <td className="tabular py-2.5 pl-3 text-right">
                      {formatPercent(scorePercent(group.results))}
                    </td>
                    <td className="tabular py-2.5 pl-3 text-right whitespace-nowrap">
                      {last ?? '—'}
                      {first !== undefined && last !== undefined && group.ratings.length > 1 && (
                        // The rating panels below show the change on phones.
                        <span className="hidden sm:inline">
                          <RatingDelta delta={last - first} className="ml-1.5" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {charts.length > 0 ? (
        <div className={cn('grid gap-4 md:grid-cols-2', showTable && 'mt-5')}>
          {charts.map((group, index) => (
            <RatingPanel
              key={group.timeClass}
              group={group}
              games={games}
              username={username}
              className={index === 0 && charts.length % 2 === 1 ? 'md:col-span-2' : undefined}
            />
          ))}
        </div>
      ) : (
        <p className={cn('text-sm text-muted', showTable && 'mt-4')}>
          A rating line appears once a time control has at least two rated games here.
        </p>
      )}
    </Section>
  );
}

function RatingDelta({ delta, className }: { delta: number; className?: string }) {
  const Icon = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{delta >= 0 ? 'up' : 'down'}</span>
      {formatSigned(delta)}
    </span>
  );
}

/** Axis labels without the time of day: dates only. */
const SHORT_LABEL_SPAN = 2 * 86_400_000;

function RatingPanel({
  group,
  games,
  username,
  className,
}: {
  group: TimeClassStats;
  games: readonly GameRecord[];
  username: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const byId = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const { ratings } = group;
  const first = ratings[0]!;
  const last = ratings.at(-1)!;
  const peak = Math.max(...ratings.map((p) => p.rating));
  const span = last.time - first.time;
  const label = formatTimeClass(group.timeClass);
  return (
    <figure className={cn('min-w-0 rounded-xl border border-line p-3 sm:p-4', className)}>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-semibold">
          {label}{' '}
          <span className="font-normal text-muted">· {plural(ratings.length, 'rated game')}</span>
        </span>
        <span className="text-xs text-muted">
          Peak <span className="tabular text-text">{peak}</span> ·{' '}
          <RatingDelta delta={last.rating - first.rating} />
        </span>
      </figcaption>
      <LineChart
        label={`${label} rating over ${plural(ratings.length, 'game')}: from ${first.rating} to ${last.rating}, peak ${peak}. Use the arrow keys to read each game, Enter to open it.`}
        // One step per game: sessions of many games and days off would otherwise squeeze the
        // games into steep cliffs joined by long flat lines.
        xs={ratings.map((_, index) => index)}
        values={ratings.map((p) => p.rating)}
        formatY={(value) => String(Math.round(value))}
        integerTicks
        xLabels={[formatAxisDate(first.time, span), formatAxisDate(last.time, span)]}
        xLabelsShort={[
          formatAxisDate(first.time, Math.max(span, SHORT_LABEL_SPAN)),
          formatAxisDate(last.time, Math.max(span, SHORT_LABEL_SPAN)),
        ]}
        endLabel={String(last.rating)}
        markers
        height={160}
        describe={(index) => {
          const point = ratings[index]!;
          const game = byId.get(point.gameId);
          const details = [formatDay(point.time)];
          if (game) {
            const { opponent } = sides(game, username);
            details.push(`vs ${opponent.name}${opponent.rating ? ` (${opponent.rating})` : ''}`);
          }
          return { value: `${point.rating}`, details };
        }}
        onActivate={(index) => {
          const point = ratings[index]!;
          navigate(reviewPath(point.gameId, { as: username }), {
            state: byId.has(point.gameId) ? { record: byId.get(point.gameId) } : undefined,
          });
        }}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------

const ENDING_COLUMNS = [
  { key: 'wins', title: 'Wins', bar: 'bg-success' },
  { key: 'draws', title: 'Draws', bar: 'bg-muted/60' },
  { key: 'losses', title: 'Losses', bar: 'bg-danger' },
] as const;

export function EndingsSection({ endings }: { endings: EndingStats }) {
  return (
    <Section title="How your games end" description="Each result split by how the game finished.">
      <div className="grid gap-5 sm:grid-cols-3 sm:gap-6">
        {ENDING_COLUMNS.map((column) => (
          <EndingColumn
            key={column.key}
            title={column.title}
            rows={endings[column.key]}
            barClass={column.bar}
          />
        ))}
      </div>
    </Section>
  );
}

function EndingColumn({
  title,
  rows,
  barClass,
}: {
  title: string;
  rows: EndingRow[];
  barClass: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
        {title}
        <span className="tabular text-xs font-normal text-muted">{total}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None in these games.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const share = (row.count / total) * 100;
            return (
              <li key={row.ending}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{ENDING_LABELS[row.ending]}</span>
                  <span className="tabular shrink-0 text-muted">
                    <span className="text-text">{row.count}</span> · {formatPercent(share)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                  <div
                    className={cn('h-full rounded-full', barClass)}
                    style={{ width: `${Math.max(2, share)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
