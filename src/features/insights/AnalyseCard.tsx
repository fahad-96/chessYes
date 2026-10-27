import { useState } from 'react';
import { Cpu, Pause, Play, Square, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GameRecord } from '@/core/types';
import { Button, buttonClass } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { PRESETS, type PresetId } from '@/engine/presets';
import { cacheKey } from '@/features/games/playerGames';
import { insightsPath } from '@/features/games/gameList';
import { useSettings, type Platform } from '@/state/settings';
import {
  cancelInsightsJob,
  dismissInsightsJob,
  isJobActive,
  jobFraction,
  startInsightsJob,
  type InsightsJob,
  type JobGameProgress,
} from './analysisJob';
import { formatEta, plural } from './format';

const COUNTS = [10, 25, 50] as const;
type Count = (typeof COUNTS)[number];

/** Choices survive leaving the page, like the job itself. */
let remembered: { count: Count; presetId: PresetId } = { count: 10, presetId: 'fast' };

export interface AnalyseCardProps {
  platform: Platform;
  username: string;
  /** Candidate games, newest first. */
  games: readonly GameRecord[];
  job: InsightsJob | null;
  /** Number of the player's games already in the library. */
  reviewedCount: number;
}

/** "Analyse my recent games": choose how many and how deep, then follow the progress. */
export function AnalyseCard({ platform, username, games, job, reviewedCount }: AnalyseCardProps) {
  const [count, setCount] = useState<Count>(remembered.count);
  const [presetId, setPresetId] = useState<PresetId>(remembered.presetId);
  const accuracyModel = useSettings((s) => s.accuracyModel);
  const playerKey = cacheKey(platform, username);
  const ours = job?.playerKey === playerKey ? job : null;
  const otherActive = job && !ours && isJobActive(job) ? job : null;
  const running = ours && isJobActive(ours);
  const selected = games.slice(0, count);

  const start = () => {
    remembered = { count, presetId };
    startInsightsJob({ platform, username, records: selected, presetId, accuracyModel });
  };

  return (
    <div className="rounded-xl bg-surface-2 p-4">
      {running ? (
        <JobProgress job={ours} />
      ) : otherActive ? (
        <div className="space-y-3">
          <p className="text-sm">
            The engine is busy analysing games for{' '}
            <span className="font-semibold">{otherActive.username}</span>. One batch runs at a time.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={insightsPath(otherActive.platform, otherActive.username)}
              className={buttonClass('secondary', 'md')}
            >
              Open their insights
            </Link>
            <Button variant="ghost" onClick={cancelInsightsJob} disabled={otherActive.stopping}>
              <Square className="h-4 w-4" aria-hidden="true" />
              {otherActive.stopping ? 'Stopping…' : 'Stop it'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {ours && <JobSummary job={ours} />}
          <div className="flex items-start gap-3">
            <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <p className="text-sm text-muted">
              Stockfish reviews your most recent games on this device, one after another, exactly as
              when you open a game, and adds them to your library.{' '}
              {reviewedCount > 0
                ? `Games you have already reviewed (${reviewedCount} so far) are skipped. `
                : ''}
              You can leave this page while it runs.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="space-y-1.5">
              <span className="block text-xs text-muted" id="kb-analyse-count">
                Games
              </span>
              <SegmentedControl
                label="Number of games to analyse"
                size="sm"
                value={String(count) as `${Count}`}
                onChange={(value) => setCount(Number(value) as Count)}
                options={COUNTS.map((n) => ({
                  value: String(n) as `${Count}`,
                  label: `Last ${n}`,
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted">Depth</span>
              <SegmentedControl
                label="Analysis depth"
                size="sm"
                value={presetId}
                onChange={setPresetId}
                options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({
                  value: id,
                  label: PRESETS[id].label,
                }))}
              />
            </div>
            <Button
              variant="primary"
              onClick={start}
              disabled={selected.length === 0}
              className="w-full sm:w-auto"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {selected.length < count
                ? `Analyse my last ${plural(selected.length, 'game')}`
                : `Analyse my last ${count} games`}
            </Button>
          </div>
          <p className="text-xs text-muted">{PRESETS[presetId].description}</p>
        </div>
      )}
    </div>
  );
}

/** "Move 31 of 66" while analysing, "Checking key moves, 3 of 12" while verifying. */
function phaseLine(current: JobGameProgress): string {
  if (current.phase === 'verifying') {
    return `Checking key moves, ${Math.min(current.done + 1, current.total)} of ${current.total}`;
  }
  // Position k is the one after move k: with k positions done, move k is being analysed.
  const move = Math.min(current.moves, Math.max(1, current.done));
  return `Move ${move} of ${current.moves}`;
}

function JobProgress({ job }: { job: InsightsJob }) {
  const current = job.current;
  const fraction = jobFraction(job);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2 self-center">
              {job.paused ? (
                <Pause className="h-4 w-4 text-muted" aria-hidden="true" />
              ) : (
                <Spinner className="h-4 w-4" label="Analysing" />
              )}
              {job.status === 'checking'
                ? 'Checking your library…'
                : `Game ${Math.max(1, job.gameNumber)} of ${job.queued}`}
            </span>
            {current && (
              <span className="min-w-0 truncate font-normal text-muted">{current.label}</span>
            )}
          </p>
          {job.paused ? (
            <p className="mt-1 text-sm text-muted">
              Paused while a review uses the engine. It continues by itself.
            </p>
          ) : (
            current && (
              <p className="tabular mt-1 text-sm text-muted">
                {phaseLine(current)}
                {job.etaMs !== null && ` · ${formatEta(job.etaMs)}`}
              </p>
            )
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={cancelInsightsJob}
          disabled={job.stopping}
          className="shrink-0"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          {job.stopping ? 'Stopping…' : 'Stop'}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Batch analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted">
        {job.skipped > 0 && `${plural(job.skipped, 'game')} already reviewed. `}
        {PRESETS[job.presetId].label} analysis. You can keep browsing; it continues in this tab.
      </p>
    </div>
  );
}

function JobSummary({ job }: { job: InsightsJob }) {
  const text =
    job.status === 'failed'
      ? (job.message ?? 'The analysis could not run.')
      : job.status === 'cancelled'
        ? `Stopped after ${plural(job.analysed, 'game')}. Start again to continue where it stopped.`
        : job.queued === 0 && job.failures.length === 0
          ? `All ${plural(job.selected, 'game')} were already reviewed.`
          : `Done: ${plural(job.analysed, 'game')} analysed${
              job.skipped > 0 ? `, ${job.skipped} already reviewed` : ''
            }.`;
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
    >
      <div className="min-w-0 text-sm">
        <p className={job.status === 'failed' ? 'text-danger' : undefined}>{text}</p>
        {job.failures.length > 0 && (
          <details className="mt-1 text-xs text-muted">
            <summary className="cursor-pointer">
              {plural(job.failures.length, 'game')} could not be analysed
            </summary>
            <ul className="mt-1 space-y-0.5">
              {job.failures.map((failure) => (
                <li key={failure.gameId} className="break-words">
                  {failure.label}: {failure.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismissInsightsJob}
        aria-label="Dismiss"
        className="-my-1 h-8 w-8 shrink-0"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
