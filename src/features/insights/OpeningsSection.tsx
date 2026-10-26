import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { Color, GameRecord } from '@/core/types';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { GameRow } from '@/features/games/GameRow';
import { useLibraryAccuracies } from '@/features/games/useLibraryAccuracies';
import { cn } from '@/lib/cn';
import type { Platform } from '@/state/settings';
import { Section } from './Section';
import { WdlBar } from './WdlBar';
import { formatPercent, plural } from './format';
import type { NameProgress } from './openingNames';
import {
  openingStats,
  sortOpeningRows,
  type OpeningRow,
  type OpeningSortKey,
  type SortDirection,
} from './stats';

const TOP_ROWS = 10;
const GAMES_STEP = 10;

interface SortState {
  key: OpeningSortKey;
  dir: SortDirection;
}

export interface OpeningsSectionProps {
  games: readonly GameRecord[];
  username: string;
  platform: Platform;
  /** Opening family of a game; null while the names are still being worked out. */
  familyOf: ((record: GameRecord) => string) | null;
  progress: NameProgress | null;
  /** The opening book could not load: families come from the sites' own names. */
  bookFailed: boolean;
}

/** Results per opening family for each colour; a row lists its games underneath. */
export function OpeningsSection({
  games,
  username,
  platform,
  familyOf,
  progress,
  bookFailed,
}: OpeningsSectionProps) {
  const [color, setColor] = useState<Color>('w');
  const [sort, setSort] = useState<SortState>({ key: 'games', dir: 'desc' });
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const stats = useMemo(
    () => (familyOf ? openingStats(games, username, familyOf) : null),
    [games, username, familyOf],
  );
  const rows = useMemo(
    () =>
      stats ? sortOpeningRows(color === 'w' ? stats.white : stats.black, sort.key, sort.dir) : [],
    [stats, color, sort],
  );
  const visible = showAll ? rows : rows.slice(0, TOP_ROWS);
  const selectedRow = rows.find((row) => row.family === selected) ?? null;

  const onSort = (key: OpeningSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'family' ? 'asc' : 'desc' },
    );

  return (
    <Section
      title="Openings"
      description={
        bookFailed
          ? 'Grouped by the names the site gives (the opening book did not load).'
          : 'Grouped by opening family, named from the first 20 moves with the opening book.'
      }
      actions={
        <SegmentedControl
          label="Colour"
          size="sm"
          value={color}
          onChange={(value) => {
            setColor(value);
            setSelected(null);
            setShowAll(false);
          }}
          options={[
            { value: 'w', label: 'As White' },
            { value: 'b', label: 'As Black' },
          ]}
        />
      }
    >
      {!stats ? (
        <div aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted" aria-live="polite">
            Naming openings
            {progress ? ` (${progress.done} of ${progress.total})` : ''}…
          </p>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No games as {color === 'w' ? 'White' : 'Black'} here.</p>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                Openings as {color === 'w' ? 'White' : 'Black'}. Choose an opening to list its
                games.
              </caption>
              <colgroup>
                <col />
                <col className="w-16" />
                <col className="hidden w-44 sm:table-column" />
                <col className="w-16" />
                <col className="hidden w-24 sm:table-column" />
              </colgroup>
              <thead>
                <tr className="text-xs text-muted">
                  <SortHeader label="Opening" sortKey="family" sort={sort} onSort={onSort} />
                  <SortHeader
                    label="Games"
                    sortKey="games"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                  <th scope="col" className="hidden pb-2 pl-4 text-left font-medium sm:table-cell">
                    Results
                  </th>
                  <SortHeader
                    label="Score"
                    sortKey="score"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                  <SortHeader
                    label="Avg opp."
                    title="Average opponent rating"
                    sortKey="opponent"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                    className="hidden sm:table-cell"
                  />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <OpeningTableRow
                    key={row.family}
                    row={row}
                    selected={row.family === selected}
                    onSelect={() => setSelected(row.family === selected ? null : row.family)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > TOP_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
              className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md pr-2 text-sm text-muted hover:text-text"
            >
              {showAll ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
              {showAll ? `Show top ${TOP_ROWS}` : `Show all ${rows.length} openings`}
            </button>
          )}
          {selectedRow && (
            <OpeningGames
              key={`${selectedRow.color}|${selectedRow.family}`}
              row={selectedRow}
              games={games}
              username={username}
              platform={platform}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </Section>
  );
}

function SortHeader({
  label,
  title,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  title?: string;
  sortKey: OpeningSortKey;
  sort: SortState;
  onSort: (key: OpeningSortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('pb-1 font-medium', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title ? `Sort by ${title.toLowerCase()}` : `Sort by ${label.toLowerCase()}`}
        className={cn(
          'inline-flex min-h-10 items-center gap-1 rounded-md hover:text-text sm:min-h-8',
          active && 'text-text',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-50')} aria-hidden="true" />
      </button>
    </th>
  );
}

function OpeningTableRow({
  row,
  selected,
  onSelect,
}: {
  row: OpeningRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      className={cn(
        'cursor-pointer border-t border-line/60 transition-colors',
        selected ? 'bg-accent/10' : 'hover:bg-surface-2',
      )}
    >
      <th scope="row" className="py-2 pr-2 text-left font-normal">
        <button
          type="button"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="block min-h-10 w-full truncate rounded-md text-left font-medium sm:min-h-8"
          title={row.family}
        >
          {row.family}
        </button>
        <WdlBar results={row.results} className="mt-1 w-28 sm:hidden" />
      </th>
      <td className="tabular py-2 text-right">{row.results.games}</td>
      <td className="hidden py-2 pl-4 sm:table-cell">
        <WdlBar results={row.results} showCounts />
      </td>
      <td className="tabular py-2 text-right">{formatPercent(row.score)}</td>
      <td className="tabular hidden py-2 text-right text-muted sm:table-cell">
        {row.opponentRating === null ? '—' : Math.round(row.opponentRating)}
      </td>
    </tr>
  );
}

function OpeningGames({
  row,
  games,
  username,
  platform,
  onClose,
}: {
  row: OpeningRow;
  games: readonly GameRecord[];
  username: string;
  platform: Platform;
  onClose: () => void;
}) {
  const [limit, setLimit] = useState(GAMES_STEP);
  const list = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]));
    return row.gameIds.flatMap((id) => {
      const game = byId.get(id);
      return game ? [game] : [];
    });
  }, [games, row]);
  const shown = useMemo(() => list.slice(0, limit), [list, limit]);
  const accuracies = useLibraryAccuracies(shown, platform, username);
  return (
    <div className="mt-4 border-t border-line pt-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold">
          <span className="truncate">{row.family}</span>
          <span className="font-normal text-muted">
            {' '}
            · {row.color === 'w' ? 'White' : 'Black'} · {plural(list.length, 'game')}
          </span>
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the game list">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <ul className="space-y-2">
        {shown.map((game) => (
          <li key={game.id}>
            <GameRow game={game} username={username} accuracy={accuracies.get(game.id)} />
          </li>
        ))}
      </ul>
      {list.length > limit && (
        <div className="mt-3 flex justify-center">
          <Button size="sm" onClick={() => setLimit((value) => value + GAMES_STEP * 2)}>
            Show more
            <span className="tabular text-muted">({list.length - limit} more)</span>
          </Button>
        </div>
      )}
    </div>
  );
}
