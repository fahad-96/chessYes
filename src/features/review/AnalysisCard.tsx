import { Cpu, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import type { AnalysisState } from './useGameReview';
import { progressPercent, progressText } from './reviewHelpers';

export interface AnalysisCardProps {
  analysis: AnalysisState;
  totalPlies: number;
  showingPreviousAnalysis: boolean;
  /** Label of the preset whose review is shown while a deeper run catches up, e.g. "Standard". */
  previousPresetLabel?: string;
  onStop: () => void;
  onResume: () => void;
  className?: string;
}

/** What screen readers hear when the run changes state (never on every progress step). */
const ANNOUNCEMENTS: Record<AnalysisState['status'], string> = {
  preparing: '',
  running: 'Analysis started.',
  paused: 'Analysis paused.',
  done: 'Analysis finished.',
  'engine-error': '',
  failed: 'Analysis stopped unexpectedly.',
};

/** Progress of the engine run, with Stop / Resume. Hidden once the analysis is done. */
export function AnalysisCard(props: AnalysisCardProps) {
  return (
    <>
      {/* Always rendered, so the region exists before its text changes. The visible detail
          line changes on every depth and estimate, which would be read out for minutes. */}
      <p aria-live="polite" className="sr-only">
        {ANNOUNCEMENTS[props.analysis.status]}
      </p>
      <AnalysisCardBody {...props} />
    </>
  );
}

function AnalysisCardBody({
  analysis,
  totalPlies,
  showingPreviousAnalysis,
  previousPresetLabel,
  onStop,
  onResume,
  className,
}: AnalysisCardProps) {
  const { status, progress, preset } = analysis;
  if (status === 'done') return null;

  if (status === 'engine-error') {
    return (
      <Card className={cn('flex items-start gap-3 border-danger/40 p-4', className)} role="alert">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div className="text-sm">
          <p className="font-semibold">Analysis unavailable</p>
          <p className="mt-0.5 text-muted">{analysis.message}</p>
        </div>
      </Card>
    );
  }

  // Position i is the one after move i, so n analysed positions cover n - 1 moves.
  const analysedMoves = Math.min(totalPlies, Math.max(0, (progress?.done ?? 0) - 1));
  const percent = progressPercent(progress);
  const deeperNote = showingPreviousAnalysis ? ` · ${preset.label.toLowerCase()} analysis` : '';

  let title: string;
  let detail: string;
  if (status === 'preparing') {
    title = 'Preparing analysis';
    detail = 'Starting the engine on your device…';
  } else if (status === 'running') {
    title = `Analysing with Stockfish${deeperNote}`;
    detail = progress ? progressText(progress, totalPlies) : 'Starting…';
  } else if (status === 'paused' && showingPreviousAnalysis) {
    title = 'Deeper analysis paused';
    const shown = previousPresetLabel ? `the ${previousPresetLabel.toLowerCase()}` : 'the earlier';
    detail = `${analysedMoves} of ${totalPlies} moves re-analysed. Showing ${shown} analysis until it finishes.`;
  } else if (status === 'paused') {
    title = 'Analysis paused';
    detail = `${analysedMoves} of ${totalPlies} moves analysed. Resume any time; finished work is saved.`;
  } else {
    title = 'Analysis stopped unexpectedly';
    detail = analysis.message ?? 'The engine stopped responding.';
  }

  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
          {status === 'running' || status === 'preparing' ? (
            <Spinner className="h-4 w-4" label="Analysing" />
          ) : status === 'failed' ? (
            <TriangleAlert aria-hidden="true" className="h-4 w-4 text-danger" />
          ) : (
            <Cpu aria-hidden="true" className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="tabular text-xs text-muted">{detail}</p>
        </div>
        {status === 'running' && (
          <Button size="sm" onClick={onStop} aria-label="Stop analysis">
            <Square aria-hidden="true" className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        {status === 'paused' && (
          <Button size="sm" variant="primary" onClick={onResume}>
            <Play aria-hidden="true" className="h-3.5 w-3.5" />
            Resume
          </Button>
        )}
        {status === 'failed' && (
          <Button size="sm" onClick={onResume}>
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            status === 'failed' ? 'bg-danger' : 'bg-accent',
            status === 'preparing' && 'animate-pulse',
          )}
          style={{ width: `${status === 'preparing' ? Math.max(percent, 8) : percent}%` }}
        />
      </div>
    </Card>
  );
}
