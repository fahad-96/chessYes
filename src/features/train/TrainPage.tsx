import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Puzzle, RotateCcw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/components/ui/useDocumentTitle';
import { pageTitle } from '@/app/seo';
import { recentGames } from '@/features/dashboard/dashboard';
import { isReviewable } from '@/features/games/gameList';
import { cacheKey } from '@/features/games/playerGames';
import { usePlayerGames } from '@/features/games/usePlayerGames';
import {
  cancelInsightsJob,
  getInsightsJob,
  isJobActive,
  jobFraction,
  startInsightsJob,
  useInsightsJob,
} from '@/features/insights/analysisJob';
import { playerKey as puzzlePlayerKey } from '@/features/puzzles/generate';
import { THEME_DESCRIPTIONS, THEME_LABELS } from '@/features/puzzles/themes';
import { getPlayerEntries } from '@/library/library';
import { cn } from '@/lib/cn';
import { useSettings, type RecentSearch } from '@/state/settings';
import { progressLines, summarizeRun, type TrainSummary } from './trainSummary';

/** The recent games one run analyses (games already reviewed are skipped quickly). */
export const TRAIN_GAMES = 10;

/**
 * /train, "Analyze my recent games": runs the connected player's latest games through
 * Stockfish (the background job the insights page uses, Fast preset), shows what is
 * happening as a few lines over a blurred board, then sums the games up and offers the
 * puzzles made from their mistakes.
 */
export default function TrainPage() {
  useDocumentTitle(pageTitle('/train'));
  const account = useSettings((s) => s.account);
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg text-text">
      <BlurredBoard />
      <div className="relative flex items-center px-4 pt-4 sm:px-6 sm:pt-6">
        <Link
          to="/home"
          className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
      </div>
      <main
        id="main"
        tabIndex={-1}
        className="relative flex flex-1 flex-col items-center px-5 pt-6 pb-12 outline-none sm:pt-10"
      >
        <h1 className="sr-only">Analyze my recent games</h1>
        {account ? (
          <TrainRun key={cacheKey(account.platform, account.username)} account={account} />
        ) : (
          <div className="mt-24 max-w-sm text-center">
            <p className="text-lg font-semibold">Connect your account first</p>
            <p className="mt-2 text-sm text-muted">
              Chess Yes analyses your latest Chess.com or Lichess games and turns your mistakes into
              puzzles.
            </p>
            <Link
              to="/home?connect"
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-button px-5 font-semibold text-accent-fg"
            >
              Connect your account
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function TrainRun({ account }: { account: RecentSearch }) {
  const { data, status, retry } = usePlayerGames(account.platform, account.username);
  const accuracyModel = useSettings((s) => s.accuracyModel);
  const job = useInsightsJob();
  const username = data?.profile.username ?? account.username;
  const key = cacheKey(account.platform, username);
  const selected = useMemo(
    () =>
      recentGames(data?.games ?? [], TRAIN_GAMES * 3)
        .filter(isReviewable)
        .slice(0, TRAIN_GAMES),
    [data],
  );
  const selectedIds = useMemo(() => new Set(selected.map((game) => game.id)), [selected]);
  const [summary, setSummary] = useState<TrainSummary | null>(null);
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const started = useRef(false);

  // Start the analysis once the games are in (or watch the run already going for this player).
  useEffect(() => {
    if (started.current || status !== 'ready' || selected.length === 0) return;
    const running = getInsightsJob();
    if (isJobActive(running)) {
      if (running?.playerKey !== key) setBusyElsewhere(true);
      else started.current = true;
      return;
    }
    started.current = true;
    startInsightsJob({
      platform: account.platform,
      username,
      records: selected,
      presetId: 'fast',
      accuracyModel,
    });
  }, [status, selected, key, account.platform, username, accuracyModel]);

  const ours = job?.playerKey === key ? job : null;
  const finished = ours?.status === 'done';

  // When the run is done, sum up its games from the library. The live job is checked (not
  // the rendered one): a finished run from an earlier visit must not count as this one.
  useEffect(() => {
    const current = getInsightsJob();
    if (!finished || !started.current || current?.status !== 'done' || current.playerKey !== key) {
      return;
    }
    let live = true;
    void getPlayerEntries(account.platform, username).then((entries) => {
      if (live) setSummary(summarizeRun(entries, selectedIds));
    });
    return () => {
      live = false;
    };
  }, [finished, key, account.platform, username, selectedIds]);

  const focusLabel = summary?.focus ? THEME_LABELS[summary.focus] : undefined;
  const lines = progressLines({
    phase: summary ? 'done' : ours && isJobActive(ours) ? 'analysing' : 'loading',
    gameNumber: ours?.gameNumber,
    queued: ours?.queued,
    opponent: ours?.current?.label,
    summary,
    focusLabel,
  });
  const fraction = ours && isJobActive(ours) ? jobFraction(ours) : summary ? 1 : 0;

  let problem: { text: string; retry?: () => void } | null = null;
  if (status === 'error' || status === 'not-found') {
    problem = { text: 'Your games could not be loaded. Check your connection.', retry };
  } else if (status === 'ready' && selected.length === 0) {
    problem = { text: 'No recent games to analyze yet. Play a few and come back.' };
  } else if (busyElsewhere) {
    problem = { text: 'Another analysis is running in this tab. Try again when it finishes.' };
  } else if (ours?.status === 'failed') {
    problem = { text: ours.message ?? 'The engine could not start in this browser.' };
  } else if (ours?.status === 'cancelled') {
    problem = { text: 'Analysis stopped. Your progress is saved.' };
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-center text-center">
      <div aria-hidden="true" className={cn('kb-orb', (summary || problem) && 'kb-orb-still')} />
      <ol
        aria-live="polite"
        className="mt-14 flex min-h-56 flex-col-reverse items-center justify-end gap-4"
      >
        {lines.map((line, index) => {
          const age = lines.length - 1 - index;
          return (
            <li
              key={line.replace(/\d+ of \d+.*/, 'progress')}
              className={cn(
                'kb-line-in text-lg font-semibold tracking-tight sm:text-2xl',
                age === 0
                  ? 'text-text'
                  : age === 1
                    ? 'text-text/75'
                    : age === 2
                      ? 'text-text/55'
                      : 'text-text/35',
              )}
            >
              {line}
            </li>
          );
        })}
      </ol>

      {!summary && !problem && (
        <div className="mt-8 w-64">
          <div className="h-1 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          {ours && isJobActive(ours) && (
            <button
              type="button"
              onClick={cancelInsightsJob}
              className="mt-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Stop
            </button>
          )}
        </div>
      )}

      {problem && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p role="alert" className="text-sm text-muted">
            {problem.text}
          </p>
          {problem.retry && (
            <Button variant="secondary" size="sm" onClick={problem.retry}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      )}

      {summary && (
        <Summary
          summary={summary}
          puzzlePlayer={puzzlePlayerKey({ platform: account.platform, username })}
        />
      )}
    </div>
  );
}

/** `puzzlePlayer`: the puzzles page's key for the player ("chesscom/hikaru"). */
function Summary({ summary, puzzlePlayer }: { summary: TrainSummary; puzzlePlayer: string }) {
  const tiles = [
    { label: 'Games analyzed', value: String(summary.games) },
    {
      label: 'Average accuracy',
      value: summary.accuracy === null ? '–' : summary.accuracy.toFixed(1),
    },
    { label: 'Mistakes', value: String(summary.mistakes) },
    { label: 'Blunders', value: String(summary.blunders) },
  ];
  const params = new URLSearchParams({ player: puzzlePlayer });
  if (summary.focus) params.set('theme', summary.focus);
  return (
    <div className="kb-glass kb-line-in mt-10 w-full rounded-3xl p-6 text-left sm:p-8">
      <h2 className="font-display text-4xl leading-tight tracking-tight">Your games, analyzed</h2>
      <ul className="mt-5 grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <li
            key={tile.label}
            className="rounded-2xl border border-glass-border bg-hover px-4 py-3"
          >
            <p className="text-xs text-muted">{tile.label}</p>
            <p className="tabular mt-0.5 text-2xl font-bold">{tile.value}</p>
          </li>
        ))}
      </ul>
      {summary.focus ? (
        <p className="mt-5 text-sm text-muted">
          <span className="font-semibold text-text">Focus: {THEME_LABELS[summary.focus]}.</span>{' '}
          {THEME_DESCRIPTIONS[summary.focus]}
        </p>
      ) : (
        <p className="mt-5 text-sm text-muted">
          No mistake in these games had one clear best answer, so there is nothing to retrain. Nice
          games!
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {summary.puzzles > 0 && (
          <Link
            to={`/puzzles?${params.toString()}`}
            className="kb-raised inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-button px-6 font-semibold text-accent-fg [--edge:4px] hover:bg-button-strong"
          >
            <Puzzle className="h-5 w-5" aria-hidden="true" />
            Start puzzles
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
        <Link
          to="/home"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-glass-border bg-hover px-6 font-medium hover:border-brand/40"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}

/** The soft, out-of-focus board and panel behind the progress lines. */
function BlurredBoard() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="kb-blur-board absolute top-[8%] left-[6%] aspect-square w-[min(60vw,640px)]" />
      <div className="absolute top-[14%] right-[6%] h-[55%] w-[28%] rounded-3xl bg-surface-3/40 blur-2xl" />
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,transparent,var(--bg)_85%)]" />
    </div>
  );
}
