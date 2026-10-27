import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ChartLine, PartyPopper, Puzzle as PuzzleIcon, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { cn } from '@/lib/cn';
import type { LibraryEntry } from '@/library/library';
import { getInteractiveEngine } from '@/practice/interactiveEngine';
import { PLATFORM_LABELS, playerPath } from '@/features/home/username';
import { useSettings } from '@/state/settings';
import {
  PUZZLE_THEMES,
  countThemes,
  generatePuzzles,
  libraryPlayers,
  playerKey,
  type Puzzle,
  type PuzzlePlayer,
  type PuzzleTheme,
} from './generate';
import {
  computeStats,
  formatDueIn,
  nextDueAt,
  pickNextPuzzle,
  pickSoonestPuzzle,
  type PuzzleOutcome,
  type PuzzleProgress,
  type PuzzleStats,
} from './progress';
import { PuzzleTrainer, type PuzzleStatus } from './PuzzleTrainer';
import { THEME_DESCRIPTIONS, THEME_LABELS } from './themes';
import { usePuzzleData } from './usePuzzleData';

type ThemeFilter = 'all' | PuzzleTheme;

/** The puzzle on screen. `serial` remounts the trainer when the same puzzle comes back. */
interface Current {
  id: string;
  status: PuzzleStatus;
  serial: number;
}

/** Practice state for one player and theme filter; starts over when either changes. */
interface Session {
  filterKey: string;
  current: Current | null;
  /** Practising puzzles that are not due yet ("Practise ahead"). */
  ahead: boolean;
  /** Skipped this session: not offered again until the filter changes or they are asked for. */
  skipped: ReadonlySet<string>;
  /** Finished this session (left out of practice ahead). */
  done: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Chooses the next puzzle: due puzzles first, then new ones; when practising ahead,
 * the puzzle due soonest among those not done this session.
 */
function choose(
  puzzles: readonly Puzzle[],
  progress: ReadonlyMap<string, PuzzleProgress>,
  session: Pick<Session, 'ahead' | 'skipped' | 'done'>,
  serial: number,
  leaveOut?: string,
): Current | null {
  const skipped = leaveOut ? new Set([...session.skipped, leaveOut]) : session.skipped;
  const due = pickNextPuzzle(puzzles, progress, Date.now(), skipped);
  if (due) return { id: due.id, status: progress.has(due.id) ? 'review' : 'new', serial };
  if (!session.ahead) return null;
  const extra = pickSoonestPuzzle(puzzles, progress, new Set([...skipped, ...session.done]));
  return extra ? { id: extra.id, status: 'ahead', serial } : null;
}

function parsePlayerParam(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

function isThemeFilter(value: string | null): value is ThemeFilter {
  return value === 'all' || PUZZLE_THEMES.includes(value as PuzzleTheme);
}

/** /puzzles: puzzles built from the mistakes in the player's reviewed games. */
export default function PuzzlesPage() {
  useDocumentTitle('Puzzles · Kibitz');
  const { entries, outdated, progress, activity, record } = usePuzzleData();
  const [params, setParams] = useSearchParams();

  const players = useMemo(() => (entries ? libraryPlayers(entries) : []), [entries]);
  const wantedPlayer = parsePlayerParam(params.get('player'));
  const player =
    players.find((candidate) => playerKey(candidate) === wantedPlayer) ?? players[0] ?? null;
  const currentPlayerKey = player ? playerKey(player) : '';

  const playerEntries = useMemo(
    () => (entries ?? []).filter((entry) => isPlayersGame(entry, currentPlayerKey)),
    [entries, currentPlayerKey],
  );
  const puzzles = useMemo(() => generatePuzzles(playerEntries), [playerEntries]);
  const themeCounts = useMemo(() => countThemes(puzzles), [puzzles]);
  const themeParam = params.get('theme');
  const theme: ThemeFilter =
    isThemeFilter(themeParam) && (themeParam === 'all' || themeCounts[themeParam] > 0)
      ? themeParam
      : 'all';
  const filtered = useMemo(
    () => (theme === 'all' ? puzzles : puzzles.filter((p) => p.themes.includes(theme))),
    [puzzles, theme],
  );
  const stats = useMemo(
    () => computeStats(puzzles, progress, activity),
    [puzzles, progress, activity],
  );

  // A new player or theme starts a new session (adjusting state while rendering, so the
  // first puzzle shows without an empty frame).
  const filterKey = `${currentPlayerKey}|${theme}`;
  const [session, setSession] = useState<Session | null>(null);
  if (entries && (session === null || session.filterKey !== filterKey)) {
    const fresh = { ahead: false, skipped: EMPTY, done: EMPTY };
    const serial = (session?.current?.serial ?? 0) + 1;
    setSession({ filterKey, ...fresh, current: choose(filtered, progress, fresh, serial) });
  }

  const currentPuzzle = session?.current
    ? (filtered.find((p) => p.id === session.current?.id) ?? null)
    : null;

  // Start the engine early, so the first move is judged without a loading pause.
  const hasPuzzle = currentPuzzle !== null;
  useEffect(() => {
    if (hasPuzzle) getInteractiveEngine().catch(() => undefined);
  }, [hasPuzzle]);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const currentId = session?.current?.id;
  const onOutcome = useCallback(
    (outcome: PuzzleOutcome) => {
      if (!currentId) return;
      record(currentId, outcome);
      setSession((s) => (s ? { ...s, done: new Set([...s.done, currentId]) } : s));
    },
    [record, currentId],
  );

  const goNext = useCallback(() => {
    setSession((s) => {
      if (!s) return s;
      const serial = (s.current?.serial ?? 0) + 1;
      return { ...s, current: choose(filtered, progress, s, serial, s.current?.id) };
    });
  }, [filtered, progress]);

  const skip = useCallback(() => {
    setSession((s) => {
      if (!s?.current) return s;
      const skipped = new Set([...s.skipped, s.current.id]);
      const next = { ...s, skipped };
      return { ...next, current: choose(filtered, progress, next, s.current.serial + 1) };
    });
  }, [filtered, progress]);

  /** Starts practising early (also brings back skipped puzzles). */
  const practiseAhead = () => {
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, ahead: true, skipped: EMPTY };
      return { ...next, current: choose(filtered, progress, next, (s.current?.serial ?? 0) + 1) };
    });
  };

  if (!entries) return <PuzzlesSkeleton />;

  if (!player) return <NoGamesState outdated={outdated} />;

  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-none">
      {/* Kept to one row on phones so the board starts high enough to show the prompt. */}
      <header className="flex items-center justify-between gap-3 sm:items-end">
        <div className="shrink-0 sm:min-w-0 sm:shrink">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Puzzles</h1>
          <p className="mt-1 hidden text-sm text-muted sm:block">
            Positions from your reviewed games where you went wrong. Find the move you missed.
          </p>
        </div>
        <PlayerPicker
          players={players}
          selected={player}
          onSelect={(next) => updateParams({ player: playerKey(next), theme: null })}
        />
      </header>

      {puzzles.length === 0 ? (
        <NoPuzzlesState player={player} games={playerEntries.length} />
      ) : (
        <>
          <StatsLine stats={stats} className="mt-2 sm:hidden" />
          <StatsBar stats={stats} className="mt-4 hidden sm:block lg:hidden" />
          <ThemeChips
            total={puzzles.length}
            counts={themeCounts}
            selected={theme}
            onSelect={(next) => updateParams({ theme: next === 'all' ? null : next })}
          />
          <div className="mt-3 lg:mt-4">
            {currentPuzzle && session?.current ? (
              <PuzzleTrainer
                key={`${currentPuzzle.id}:${session.current.serial}`}
                puzzle={currentPuzzle}
                status={session.current.status}
                onOutcome={onOutcome}
                onNext={goNext}
                onSkip={skip}
                aside={<StatsBar stats={stats} className="hidden lg:block" />}
              />
            ) : (
              <CaughtUpState
                nextDue={nextDueAt(filtered, progress)}
                skipped={session?.skipped.size ?? 0}
                canPractiseAhead={filtered.some((p) => !session?.done.has(p.id))}
                onPractiseAhead={practiseAhead}
                player={player}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Whether a library entry is one of the player's games. */
function isPlayersGame(entry: LibraryEntry, key: string): boolean {
  return (
    !!entry.perspective &&
    playerKey({ platform: entry.perspective.platform, username: entry.perspective.username }) ===
      key
  );
}

function playerLabel(player: PuzzlePlayer): string {
  return `${player.username} · ${PLATFORM_LABELS[player.platform]}`;
}

function insightsPath(player: PuzzlePlayer): string {
  return `/insights/${player.platform}/${encodeURIComponent(player.username)}`;
}

function PlayerPicker({
  players,
  selected,
  onSelect,
}: {
  players: readonly PuzzlePlayer[];
  selected: PuzzlePlayer;
  onSelect: (player: PuzzlePlayer) => void;
}) {
  const id = useId();
  if (players.length < 2) {
    return (
      <p className="inline-flex h-10 max-w-full min-w-0 items-center rounded-lg border border-line bg-surface px-3 text-sm">
        <span className="sr-only">Player: </span>
        <span className="truncate">{playerLabel(selected)}</span>
      </p>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only text-sm text-muted sm:not-sr-only">
        Player
      </label>
      <select
        id={id}
        value={playerKey(selected)}
        onChange={(event) => {
          const next = players.find((p) => playerKey(p) === event.target.value);
          if (next) onSelect(next);
        }}
        className="h-10 w-full max-w-[16rem] min-w-0 truncate rounded-lg border border-line bg-surface px-2 text-sm text-text hover:bg-surface-2 sm:w-auto sm:px-3"
      >
        {players.map((p) => (
          <option key={playerKey(p)} value={playerKey(p)}>
            {playerLabel(p)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ThemeChips({
  total,
  counts,
  selected,
  onSelect,
}: {
  total: number;
  counts: Record<PuzzleTheme, number>;
  selected: ThemeFilter;
  onSelect: (theme: ThemeFilter) => void;
}) {
  const themes = PUZZLE_THEMES.filter((theme) => counts[theme] > 0);
  const count = (n: number) => <span className="tabular text-xs text-muted">{n}</span>;
  return (
    <div
      role="group"
      aria-label="Puzzle theme"
      // One scrollable row on phones (it scrolls inside itself, never the page); wraps on
      // larger screens. The negative margin lets it run under the page gutter while scrolling.
      className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <Chip selected={selected === 'all'} onClick={() => onSelect('all')} className="shrink-0">
        All {count(total)}
      </Chip>
      {themes.map((theme) => (
        <Chip
          key={theme}
          selected={selected === theme}
          onClick={() => onSelect(theme)}
          title={THEME_DESCRIPTIONS[theme]}
          className="shrink-0"
        >
          {THEME_LABELS[theme]} {count(counts[theme])}
        </Chip>
      ))}
    </div>
  );
}

function StatsBar({ stats, className }: { stats: PuzzleStats; className?: string }) {
  const items: { label: string; value: string; title: string }[] = [
    {
      label: 'Due today',
      value: String(stats.dueToday),
      title: `${stats.dueToday} puzzles to practise today, ${stats.fresh} of them new`,
    },
    {
      label: 'Solved',
      value: `${stats.solved}/${stats.total}`,
      title: 'Puzzles solved on the first try at least once',
    },
    {
      label: 'Success',
      value: stats.successRate === null ? '—' : `${Math.round(stats.successRate * 100)}%`,
      title: 'Attempts solved on the first try without a hint',
    },
    {
      label: 'Streak',
      value: stats.streak === 1 ? '1 day' : `${stats.streak} days`,
      title: 'Days in a row with puzzle practice',
    },
  ];
  return (
    <Card className={className}>
      <h2 className="sr-only">Your progress</h2>
      <dl className="grid grid-cols-4 divide-x divide-line">
        {items.map((item) => (
          <div
            key={item.label}
            title={item.title}
            className="flex min-w-0 flex-col items-center px-1 py-2.5 text-center sm:py-3"
          >
            <dt className="order-2 text-[11px] leading-tight text-muted sm:text-xs">
              {item.label}
            </dt>
            <dd className="tabular order-1 truncate text-base font-semibold sm:text-lg">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The same numbers as StatsBar in one line of text, for phones. */
function StatsLine({ stats, className }: { stats: PuzzleStats; className?: string }) {
  const parts = [
    `${stats.dueToday} due today`,
    `${stats.solved}/${stats.total} solved`,
    stats.successRate === null ? null : `${Math.round(stats.successRate * 100)}% success`,
    stats.streak > 0 ? `${stats.streak}-day streak` : null,
  ].filter(Boolean);
  return <p className={cn('text-xs text-muted', className)}>{parts.join(' · ')}</p>;
}

function CaughtUpState({
  nextDue,
  skipped,
  canPractiseAhead,
  onPractiseAhead,
  player,
}: {
  nextDue: number | null;
  skipped: number;
  canPractiseAhead: boolean;
  onPractiseAhead: () => void;
  player: PuzzlePlayer;
}) {
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 px-5 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-success/15 text-success">
        <PartyPopper aria-hidden="true" className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold">
        {skipped > 0 ? 'Nothing else is due' : 'You’re all caught up'}
      </h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        {skipped > 0 ? `You skipped ${skipped === 1 ? 'one puzzle' : `${skipped} puzzles`}. ` : ''}
        {nextDue !== null && nextDue > Date.now()
          ? `The next puzzle is due ${formatDueIn(nextDue)}. `
          : ''}
        Review more of your games to get new puzzles.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {canPractiseAhead && (
          <button type="button" onClick={onPractiseAhead} className={buttonClass('primary')}>
            {skipped > 0 ? 'Show skipped puzzles' : 'Practise ahead'}
          </button>
        )}
        <Link to={playerPath(player.platform, player.username)} className={buttonClass()}>
          Review more games
        </Link>
      </div>
    </Card>
  );
}

function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mx-auto mt-4 flex max-w-xl flex-col items-center gap-3 px-5 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <PuzzleIcon aria-hidden="true" className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold text-balance">{title}</h2>
      {children}
    </Card>
  );
}

/**
 * No reviewed games with a known player yet. `outdated` games were reviewed by an older
 * version of Kibitz: they no longer count, which the card explains.
 */
function NoGamesState({ outdated }: { outdated: number }) {
  const recent = useSettings((s) => s.recent[0]);
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Puzzles</h1>
      <EmptyCard title="Puzzles come from your reviewed games">
        {outdated > 0 && (
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Kibitz has changed how it scores games since you last reviewed, so those games need a
            fresh review before they make puzzles again. Your puzzle progress is kept.
          </p>
        )}
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Every mistake, blunder and miss in a game you review becomes a puzzle: the position is set
          up so you can find the move you missed, and the ones you get wrong come back until they
          stick.
        </p>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Look up your Chess.com or Lichess games and review a few. (Imported PGNs don’t count:
          Kibitz can’t tell which side you played.)
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {recent && (
            <Link
              to={insightsPath({ platform: recent.platform, username: recent.username })}
              className={buttonClass('primary')}
            >
              <ChartLine aria-hidden="true" className="h-4 w-4" />
              Analyse my recent games
            </Link>
          )}
          <Link to="/" className={buttonClass(recent ? 'secondary' : 'primary')}>
            <Search aria-hidden="true" className="h-4 w-4" />
            Find my games
          </Link>
        </div>
      </EmptyCard>
    </div>
  );
}

/** Reviewed games exist for the player, but none had a clear puzzle. */
function NoPuzzlesState({ player, games }: { player: PuzzlePlayer; games: number }) {
  return (
    <EmptyCard title={`No puzzles for ${player.username} yet`}>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        {games === 1 ? 'Your reviewed game has' : `None of your ${games} reviewed games have`} a
        mistake with one clear best answer. That’s good news! Review more games to get puzzles.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link to={insightsPath(player)} className={buttonClass('primary')}>
          <ChartLine aria-hidden="true" className="h-4 w-4" />
          Analyse my recent games
        </Link>
        <Link to={playerPath(player.platform, player.username)} className={buttonClass()}>
          Pick a game
        </Link>
      </div>
    </EmptyCard>
  );
}

function PuzzlesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-none" aria-busy="true">
      <span className="sr-only" role="status">
        Loading puzzles
      </span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <Skeleton className="mt-4 h-14 w-full lg:hidden" />
      <div className="mt-4 flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <Skeleton className="aspect-square w-full md:mx-auto md:max-w-[max(20rem,calc(100dvh-26rem))] lg:max-w-[calc(100dvh-14rem)]" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
