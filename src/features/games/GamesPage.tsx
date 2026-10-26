import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ChartLine,
  ExternalLink,
  RefreshCw,
  SearchX,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import {
  PLATFORM_LABELS,
  isPlatform,
  playerPath,
  validateUsername,
} from '@/features/home/username';
import { useSettings, type Platform } from '@/state/settings';
import { GameFiltersBar } from './GameFiltersBar';
import { GameRow } from './GameRow';
import {
  DEFAULT_FILTERS,
  availableTimeClasses,
  filterGames,
  formatMonth,
  groupByMonth,
  insightsPath,
  type GameFilters,
} from './gameList';
import { cacheKey, loadErrorMessage, type GameListData, type PlayerProfile } from './playerGames';
import { useLibraryAccuracies } from './useLibraryAccuracies';
import { usePlayerGames, type PlayerGamesState } from './usePlayerGames';

/** Rows rendered at a time; very active players can have thousands of games a month. */
const RENDER_STEP = 100;

interface ListView {
  filters: GameFilters;
  /** How many matching games are rendered. */
  limit: number;
}

/** Filters and list length survive a trip to a review and back, like the list itself. */
const viewMemory = new Map<string, ListView>();

/** /player/:platform/:username: the player's games, newest first. */
export default function GamesPage() {
  const params = useParams();
  const username = (params.username ?? '').trim();
  if (!isPlatform(params.platform)) {
    return (
      <Notice icon={<SearchX className="h-6 w-6" />} title="Unknown game site">
        Kibitz can load games from Chess.com and Lichess.
      </Notice>
    );
  }
  const problem = validateUsername(params.platform, username);
  if (problem) {
    return (
      <Notice icon={<SearchX className="h-6 w-6" />} title="That username does not look right">
        {problem}
      </Notice>
    );
  }
  const key = cacheKey(params.platform, username);
  return <PlayerGames key={key} cacheId={key} platform={params.platform} username={username} />;
}

interface PlayerGamesProps {
  cacheId: string;
  platform: Platform;
  username: string;
}

function PlayerGames({ cacheId, platform, username }: PlayerGamesProps) {
  useDocumentTitle(`${username} · ${PLATFORM_LABELS[platform]} games · Kibitz`);
  const games = usePlayerGames(platform, username);
  const { data, status } = games;
  const [view, setViewState] = useState<ListView>(
    () => viewMemory.get(cacheId) ?? { filters: DEFAULT_FILTERS, limit: RENDER_STEP },
  );
  const setView = (next: ListView) => {
    viewMemory.set(cacheId, next);
    setViewState(next);
  };
  const site = PLATFORM_LABELS[platform];

  // A name that does not exist on this site (usually a typo) is not worth keeping in the
  // recent searches the home page offers.
  const removeRecent = useSettings((s) => s.removeRecent);
  useEffect(() => {
    if (status === 'not-found') removeRecent({ platform, username });
  }, [status, platform, username, removeRecent]);

  return (
    <div className="space-y-5">
      {status !== 'not-found' && (
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          New search
        </Link>
      )}

      {/* Announces progress to screen readers without moving focus. */}
      <p aria-live="polite" className="sr-only">
        {status === 'loading' || games.loadingMore ? (games.progressLabel ?? 'Loading games') : ''}
      </p>

      {status === 'not-found' ? (
        <Notice
          icon={<UserX className="h-6 w-6" />}
          title={`No ${site} player called “${username}”`}
          action={<OtherSiteLink platform={platform} username={username} />}
        >
          Check the spelling, or try the other site.
        </Notice>
      ) : status === 'error' && !data ? (
        <ErrorCard
          message={loadErrorMessage(games.error?.kind ?? 'other', platform)}
          detail={games.error?.kind === 'other' ? games.error.detail : undefined}
          onRetry={games.retry}
        />
      ) : !data ? (
        <LoadingState label={games.progressLabel} />
      ) : (
        <>
          <ProfileHeader profile={data.profile} onRefresh={games.refresh} />
          <GameList
            data={data}
            state={games}
            view={view}
            onViewChange={setView}
            onLoadMore={games.loadMore}
            onRetry={games.retry}
          />
        </>
      )}
    </div>
  );
}

function ProfileHeader({ profile, onRefresh }: { profile: PlayerProfile; onRefresh: () => void }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = profile.avatar && !avatarFailed;
  return (
    // The actions wrap under the name on narrow phones instead of squeezing it.
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-4">
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3 sm:gap-4">
        {showAvatar ? (
          <img
            src={profile.avatar}
            alt=""
            width={56}
            height={56}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-14 w-14 shrink-0 rounded-xl border border-line bg-surface-2 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-xl font-bold text-muted uppercase"
          >
            {profile.username.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {profile.title && <Badge tone="accent">{profile.title}</Badge>}
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {profile.username}
            </h1>
          </div>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted">
            {profile.name && <span className="truncate">{profile.name}</span>}
            <a
              href={profile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:text-text hover:underline"
            >
              Profile on {PLATFORM_LABELS[profile.platform]}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Link
          to={insightsPath(profile.platform, profile.username)}
          className={buttonClass('secondary', 'md')}
          title="Results, openings and accuracy across your games"
        >
          <ChartLine className="h-4 w-4" aria-hidden="true" />
          Insights
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          aria-label="Reload games"
          title="Reload games"
        >
          <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface GameListProps {
  data: GameListData;
  state: PlayerGamesState;
  view: ListView;
  onViewChange: (view: ListView) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

function GameList({ data, state, view, onViewChange, onLoadMore, onRetry }: GameListProps) {
  const { filters, limit } = view;
  const username = data.profile.username;
  const timeClasses = useMemo(() => availableTimeClasses(data.games), [data.games]);
  // A filter for a time class that is no longer present would hide everything silently.
  const effective = useMemo<GameFilters>(
    () =>
      filters.timeClass !== 'all' && !timeClasses.includes(filters.timeClass)
        ? { ...filters, timeClass: 'all' }
        : filters,
    [filters, timeClasses],
  );
  const visible = useMemo(
    () => filterGames(data.games, username, effective),
    [data.games, username, effective],
  );
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const accuracies = useLibraryAccuracies(shown, data.profile.platform, username);
  const hidden = Math.max(0, visible.length - limit);
  const onFiltersChange = (next: GameFilters) =>
    onViewChange({ filters: next, limit: RENDER_STEP });
  const filtered =
    effective.timeClass !== 'all' || effective.result !== 'all' || effective.opponent.trim() !== '';
  const site = PLATFORM_LABELS[data.profile.platform];

  if (data.games.length === 0 && !data.hasMore && !state.error) {
    return (
      <Notice icon={<SearchX className="h-6 w-6" />} title="No games yet" level={2}>
        {username} has no games on {site} that we can load.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      {data.games.length > 0 && (
        <GameFiltersBar filters={effective} onChange={onFiltersChange} timeClasses={timeClasses} />
      )}

      {data.games.length > 0 && (
        <p className="tabular text-sm text-muted">
          {filtered
            ? `Showing ${visible.length} of ${data.games.length} loaded games`
            : `${data.games.length} ${data.games.length === 1 ? 'game' : 'games'} loaded`}
        </p>
      )}

      {visible.length === 0 && data.games.length > 0 && (
        <Card className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="font-medium">No games match these filters</p>
          <p className="text-sm text-muted">
            {data.hasMore ? 'Try other filters, or load older games.' : 'Try other filters.'}
          </p>
          <Button size="sm" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
            Clear filters
          </Button>
        </Card>
      )}

      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {group.label}
          </h2>
          <ul className="space-y-2">
            {group.games.map((game) => (
              <li key={game.id}>
                <GameRow game={game} username={username} accuracy={accuracies.get(game.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Both buttons can show at once: a busy month should not hide the older months. */}
      {(hidden > 0 || (data.hasMore && !state.error)) && (
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {hidden > 0 && (
            <Button onClick={() => onViewChange({ ...view, limit: limit + RENDER_STEP })}>
              Show more
              <span className="tabular text-muted">({hidden} more loaded)</span>
            </Button>
          )}
          {data.hasMore && !state.error && (
            <Button
              onClick={() => {
                // Make room for the next page so its games appear without another click.
                onViewChange({ ...view, limit: Math.max(limit, visible.length + RENDER_STEP) });
                onLoadMore();
              }}
              disabled={state.loadingMore}
              className="min-w-52"
            >
              {state.loadingMore ? (
                <>
                  <Spinner label="Loading" />
                  {state.progressLabel ?? 'Loading games'}…
                </>
              ) : (
                <>
                  {data.profile.platform === 'chesscom' ? 'Load older games' : 'Load more games'}
                  <NextMonthHint data={data} />
                </>
              )}
            </Button>
          )}
        </div>
      )}
      {state.error ? (
        <ErrorCard
          message={loadErrorMessage(state.error.kind, data.profile.platform)}
          detail={state.error.kind === 'other' ? state.error.detail : undefined}
          onRetry={onRetry}
        />
      ) : (
        hidden === 0 &&
        !data.hasMore &&
        data.games.length > 0 && (
          <p className="pt-2 text-center text-sm text-muted">No older games.</p>
        )
      )}
    </div>
  );
}

/** "(September 2026)" next to the Chess.com load button, so people know what comes next. */
function NextMonthHint({ data }: { data: GameListData }) {
  if (data.cursor.platform !== 'chesscom') return null;
  const next = data.cursor.archives[data.cursor.next];
  if (!next) return null;
  return <span className="text-muted">({formatMonth(next.year, next.month)})</span>;
}

function LoadingState({ label }: { label: string | null }) {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <ul className="space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 sm:px-4"
          >
            <Skeleton className="h-7 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="hidden h-3 w-20 sm:block" />
          </li>
        ))}
      </ul>
      <p className="flex items-center justify-center gap-2 text-sm text-muted">
        <Spinner label="Loading" />
        {label ? `${label}…` : 'Loading games…'}
      </p>
    </div>
  );
}

function ErrorCard({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
}) {
  return (
    <Card role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <TriangleAlert className="h-6 w-6 text-danger" aria-hidden="true" />
      <p className="font-medium">{message}</p>
      {detail && <p className="max-w-md text-sm break-words text-muted">{detail}</p>}
      <Button onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </Button>
    </Card>
  );
}

/** "Search Lichess instead" (or Chess.com), when the name is valid there too. */
function OtherSiteLink({ platform, username }: { platform: Platform; username: string }) {
  const other: Platform = platform === 'chesscom' ? 'lichess' : 'chesscom';
  if (validateUsername(other, username)) return null;
  return (
    <Link to={playerPath(other, username)} className={buttonClass('ghost', 'md')}>
      Search {PLATFORM_LABELS[other]} instead
    </Link>
  );
}

interface NoticeProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  /** An extra button next to "Back to search". */
  action?: ReactNode;
  /** Use 2 when the page already has an h1 (the profile header). */
  level?: 1 | 2;
}

function Notice({ icon, title, children, action, level = 1 }: NoticeProps) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="text-muted" aria-hidden="true">
        {icon}
      </span>
      <Heading className="text-lg font-semibold break-words">{title}</Heading>
      <p className="text-sm text-muted">{children}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link to="/" className={buttonClass('secondary', 'md')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to search
        </Link>
        {action}
      </div>
    </Card>
  );
}
