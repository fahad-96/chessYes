import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ChartLine,
  FileUp,
  Link2,
  ListFilter,
  Puzzle,
  RotateCcw,
  Sparkles,
  Swords,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import type { GameRecord, TimeClass } from '@/core/types';
import { pageTitle } from '@/app/seo';
import { OUTCOME_STYLES } from '@/features/games/GameRow';
import {
  insightsPath,
  isReviewable,
  outcomeForPlayer,
  reviewPath,
} from '@/features/games/gameList';
import { loadErrorMessage, type PlayerProfile } from '@/features/games/playerGames';
import { TIME_CLASS_ICONS } from '@/features/games/timeClassIcons';
import { useLibraryAccuracies } from '@/features/games/useLibraryAccuracies';
import { usePlayerGames } from '@/features/games/usePlayerGames';
import { PLATFORM_LABELS, playerPath } from '@/features/home/username';
import { cn } from '@/lib/cn';
import { formatAccuracy, formatGameDate, formatTimeClass, formatTimeControl } from '@/lib/format';
import { useSettings, type RecentSearch } from '@/state/settings';
import { ConnectAccountDialog } from './ConnectAccountDialog';
import { greetingFor, latestRatings, recentGames, type RatingChip } from './dashboard';

const GAMES_SHOWN = 9;

/**
 * /home, the app's home. With a connected account: a greeting, the player's ratings and their
 * latest games to review. Without one: the "Connect your account" dialog over a blurred
 * preview, or (once they chose to go on without an account) the ways in that need none.
 * /home?connect opens the dialog again, to connect or change the account.
 */
export default function DashboardPage() {
  useDocumentTitle(pageTitle('/home'));
  const account = useSettings((s) => s.account);
  const skipped = useSettings((s) => s.skippedConnect);
  const setSettings = useSettings((s) => s.set);
  const [params, setParams] = useSearchParams();
  const askedToConnect = params.has('connect');
  // Opens by itself for a first visit, and stays open through "You're all set" even though
  // the account is saved one step earlier: only the dialog closes itself.
  const [firstVisit, setFirstVisit] = useState(() => !account && !skipped);
  const dialogOpen = askedToConnect || firstVisit;

  const closeDialog = (withoutAccount: boolean) => {
    if (withoutAccount && !useSettings.getState().account) setSettings({ skippedConnect: true });
    setFirstVisit(false);
    if (askedToConnect) {
      const next = new URLSearchParams(params);
      next.delete('connect');
      setParams(next, { replace: true });
    }
  };
  const openDialog = () => setParams({ connect: '' });

  let content: ReactNode;
  if (account) {
    content = (
      <AccountHome
        key={`${account.platform}:${account.username.toLowerCase()}`}
        account={account}
        onChangeAccount={openDialog}
      />
    );
  } else if (dialogOpen) {
    content = <PreviewHome />;
  } else {
    content = <GuestHome onConnect={openDialog} />;
  }

  return (
    <>
      {content}
      <ConnectAccountDialog open={dialogOpen} onClose={closeDialog} />
    </>
  );
}

function Greeting({
  name,
  detail,
  avatar,
  action,
}: {
  name: string;
  detail?: ReactNode;
  avatar: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-5 sm:gap-7">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="text-lg text-muted sm:text-xl">{greetingFor(new Date())},</p>
        <h1 className="truncate font-display text-[clamp(2.75rem,7vw,4.75rem)] leading-[1.02] tracking-[-0.01em]">
          {name}
        </h1>
        {detail && <p className="mt-1 text-sm text-muted">{detail}</p>}
      </div>
      {action}
    </header>
  );
}

function Avatar({ profile, name }: { profile?: PlayerProfile | null; name: string }) {
  const className =
    'h-20 w-20 shrink-0 rounded-[1.4rem] ring-1 ring-glass-border shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] sm:h-28 sm:w-28';
  if (profile?.avatar) {
    return <img src={profile.avatar} alt="" className={cn(className, 'object-cover')} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        className,
        'flex items-center justify-center bg-gradient-to-br from-brand/35 to-brand/10 font-display text-5xl text-text sm:text-6xl',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Ratings({ ratings }: { ratings: RatingChip[] }) {
  if (ratings.length === 0) return null;
  return (
    <ul className="mt-7 flex flex-wrap gap-2.5" aria-label="Ratings">
      {ratings.map(({ timeClass, rating }) => {
        const Icon = TIME_CLASS_ICONS[timeClass];
        return (
          <li
            key={timeClass}
            className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-hover py-1.5 pr-1.5 pl-3 text-sm"
          >
            <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
            <span className="text-muted">{formatTimeClass(timeClass)}</span>
            <span className="tabular rounded-full bg-surface-3 px-2.5 py-0.5 font-semibold">
              {rating}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The highlighted call to action under the greeting. */
function Spotlight() {
  return (
    <Card className="relative mt-8 flex flex-col gap-5 overflow-hidden p-6 sm:flex-row sm:items-center sm:p-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_50%,rgb(124_186_74/0.18),transparent_70%)]"
      />
      <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <Sparkles className="h-7 w-7" aria-hidden="true" />
      </span>
      <div className="relative min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Puzzles from your own mistakes
        </h2>
        <p className="mt-1 text-sm text-muted sm:text-base">
          Analyze your latest games, then retrain the moves you got wrong. The ones you miss come
          back until they stick.
        </p>
      </div>
      <div className="relative flex shrink-0 flex-col gap-2 sm:items-end">
        <Link
          to="/train"
          className="kb-raised inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-button px-5 font-semibold text-accent-fg [--edge:3px] hover:bg-button-strong"
        >
          Analyze my recent games
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          to="/puzzles"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand hover:bg-brand/10"
        >
          Go to my puzzles
        </Link>
      </div>
    </Card>
  );
}

function GamesHeading({ actions }: { actions?: ReactNode }) {
  return (
    <div className="mt-14 flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-none tracking-[-0.01em]">
        Analyze your games
      </h2>
      <div className="flex gap-2">
        {actions}
        <Link
          to="/import"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-glass-border bg-hover px-4 text-sm font-medium transition-colors hover:border-brand/40"
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          Import
        </Link>
      </div>
    </div>
  );
}

function AccountHome({
  account,
  onChangeAccount,
}: {
  account: RecentSearch;
  onChangeAccount: () => void;
}) {
  const { data, status, error, retry } = usePlayerGames(account.platform, account.username);
  const username = data?.profile.username ?? account.username;
  const games = useMemo(() => recentGames(data?.games ?? [], GAMES_SHOWN), [data]);
  const ratings = useMemo(() => latestRatings(data?.games ?? [], username), [data, username]);
  const accuracies = useLibraryAccuracies(games, account.platform, username);
  const name = data?.profile.name || username;

  return (
    <div className="pb-10">
      <Greeting
        name={name}
        avatar={<Avatar profile={data?.profile} name={name} />}
        detail={
          <>
            @{username} · {PLATFORM_LABELS[account.platform]} ·{' '}
            <button
              type="button"
              onClick={onChangeAccount}
              className="underline-offset-4 hover:text-text hover:underline"
            >
              Change account
            </button>
          </>
        }
      />
      <Ratings ratings={ratings} />
      <Spotlight />
      <GamesHeading
        actions={
          <>
            <Link
              to={insightsPath(account.platform, username)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-glass-border bg-hover px-4 text-sm font-medium transition-colors hover:border-brand/40"
            >
              <ChartLine className="h-4 w-4" aria-hidden="true" />
              Insights
            </Link>
            <Link
              to={playerPath(account.platform, username)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-glass-border bg-hover px-4 text-sm font-medium transition-colors hover:border-brand/40"
            >
              <ListFilter className="h-4 w-4" aria-hidden="true" />
              All games
            </Link>
          </>
        }
      />
      {status === 'loading' && <GameGridSkeleton />}
      {(status === 'error' || status === 'not-found') && (
        <Card className="mt-6 flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-muted">
            {status === 'not-found'
              ? `${PLATFORM_LABELS[account.platform]} no longer knows ${username}. Connect another account.`
              : loadErrorMessage(error?.kind ?? 'other', account.platform)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={status === 'not-found' ? onChangeAccount : retry}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {status === 'not-found' ? 'Change account' : 'Try again'}
          </Button>
        </Card>
      )}
      {status === 'ready' && games.length === 0 && (
        <Card className="mt-6 p-5 text-sm text-muted">
          No games yet. Play a game on {PLATFORM_LABELS[account.platform]}, or try one against
          Stockfish here.
        </Card>
      )}
      {games.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <li key={game.id}>
              <GameCard game={game} username={username} accuracy={accuracies.get(game.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GameCard({
  game,
  username,
  accuracy,
}: {
  game: GameRecord;
  username: string;
  accuracy?: number;
}) {
  const outcome = OUTCOME_STYLES[outcomeForPlayer(game, username)];
  const TimeIcon = TIME_CLASS_ICONS[game.timeClass];
  const reviewable = isReviewable(game);
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <TimeIcon className="h-4 w-4" aria-hidden="true" />
          {formatTimeControl(game.timeControl) || formatTimeClass(game.timeClass)}
        </span>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase',
            outcome.className,
          )}
        >
          {outcome.label}
        </span>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {(['white', 'black'] as const).map((side) => (
          <li key={side} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'h-3 w-3 shrink-0 rounded-[3px] ring-1',
                  side === 'white'
                    ? 'bg-[var(--eval-white)] ring-black/20'
                    : 'bg-[var(--eval-black)] ring-white/15',
                )}
              />
              <span
                className={cn(
                  'truncate',
                  game[side].name.toLowerCase() === username.toLowerCase() && 'font-semibold',
                )}
              >
                {game[side].name}
              </span>
            </span>
            <span className="tabular shrink-0 text-muted">{game[side].rating ?? ''}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-glass-border pt-3 text-xs text-muted">
        <span>{formatGameDate(game.endTime)}</span>
        <span className={cn(accuracy !== undefined && 'font-semibold text-text')}>
          {accuracy !== undefined
            ? `Accuracy ${formatAccuracy(accuracy)}`
            : reviewable
              ? 'Review →'
              : 'Not reviewable'}
        </span>
      </div>
    </>
  );
  const className =
    'kb-card block h-full rounded-2xl border p-4 transition-[border-color,transform] sm:p-5';
  if (!reviewable) return <div className={cn(className, 'opacity-60')}>{body}</div>;
  return (
    <Link
      to={reviewPath(game.id, { as: username })}
      className={cn(className, 'hover:-translate-y-0.5 hover:border-brand/40')}
    >
      {body}
    </Link>
  );
}

function GameGridSkeleton() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your games
      </span>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-2xl" />
      ))}
    </div>
  );
}

/** No account, by choice: the ways in that need none, and a way to connect later. */
function GuestHome({ onConnect }: { onConnect: () => void }) {
  const actions = [
    {
      to: '/play',
      icon: Swords,
      title: 'Play Stockfish',
      body: 'Eight strengths, then review the game.',
    },
    { to: '/import', icon: FileUp, title: 'Analyze a PGN', body: 'Paste or upload any game.' },
    { to: '/puzzles', icon: Puzzle, title: 'Puzzles', body: 'Train on the mistakes you review.' },
  ];
  return (
    <div className="pb-10">
      <Greeting name="Welcome" avatar={<Avatar name="Chess Yes" />} />
      <Card className="mt-8 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <Link2 className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <p className="flex-1 text-sm sm:text-base">
          <span className="font-semibold">Connect Chess.com or Lichess</span>{' '}
          <span className="text-muted">to see your games here and review them in one click.</span>
        </p>
        <Button variant="primary" onClick={onConnect}>
          Connect
        </Button>
      </Card>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {actions.map(({ to, icon: Icon, title, body }) => (
          <li key={to}>
            <Link
              to={to}
              className="kb-card block h-full rounded-2xl border p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand/40"
            >
              <Icon className="h-6 w-6 text-brand" aria-hidden="true" />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PREVIEW_GAMES: {
  tc: string;
  timeClass: TimeClass;
  result: 'win' | 'loss' | 'draw';
  white: [string, number];
  black: [string, number];
}[] = [
  {
    tc: '3+0',
    timeClass: 'blitz',
    result: 'win',
    white: ['Magnus', 1800],
    black: ['Hikaru', 1750],
  },
  {
    tc: '5+3',
    timeClass: 'blitz',
    result: 'loss',
    white: ['Hikaru', 1800],
    black: ['Magnus', 1750],
  },
  {
    tc: '10+0',
    timeClass: 'rapid',
    result: 'draw',
    white: ['Magnus', 1800],
    black: ['Fabi', 1750],
  },
];

/** What /home looks like once connected, shown (blurred by the dialog) while connecting. */
function PreviewHome() {
  return (
    <div aria-hidden="true" className="pointer-events-none pb-10 select-none">
      <Greeting name="@username" detail="Chess.com" avatar={<Avatar name="You" />} />
      <Ratings
        ratings={[
          { timeClass: 'rapid', rating: 1850 },
          { timeClass: 'blitz', rating: 1720 },
          { timeClass: 'bullet', rating: 1640 },
        ]}
      />
      <Spotlight />
      <GamesHeading />
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PREVIEW_GAMES.map((game) => {
          const Icon = TIME_CLASS_ICONS[game.timeClass];
          const outcome = OUTCOME_STYLES[game.result];
          return (
            <li key={game.tc} className="kb-card rounded-2xl border p-5">
              <div className="flex items-center justify-between text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-4 w-4" />
                  {game.tc}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-bold uppercase',
                    outcome.className,
                  )}
                >
                  {outcome.label}
                </span>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {[game.white, game.black].map(([player, rating], i) => (
                  <li key={i} className="flex justify-between">
                    <span>{player}</span>
                    <span className="text-muted">{rating}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
