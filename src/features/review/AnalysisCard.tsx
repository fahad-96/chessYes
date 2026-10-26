import { Check, Cpu, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import type { AnalysisState, PassProgress } from './useGameReview';
import { describeAnalysis, progressPercent } from './reviewHelpers';

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

/**
 * Progress of the engine run, with Stop / Resume. The run has up to three passes (a quick
 * review, the preset's depth, a double-check of the key moves), shown as a segmented bar.
 * Hidden once the analysis is done.
 */
export function AnalysisCard(props: AnalysisCardProps) {
  const { announcement } = describeAnalysis(props.analysis, {
    totalMoves: props.totalPlies,
    showingPreviousAnalysis: props.showingPreviousAnalysis,
  });
  return (
    <>
      {/* Always rendered, so the region exists before its text changes. The visible detail
          line changes on every depth and estimate, which would be read out for minutes. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
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
  const { status } = analysis;
  if (status === 'done') return null;

  const { title, detail } = describeAnalysis(analysis, {
    totalMoves: totalPlies,
    showingPreviousAnalysis,
    previousPresetLabel,
  });

  if (status === 'engine-error') {
    return (
      <Card className={cn('flex items-start gap-3 border-danger/40 p-4', className)} role="alert">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div className="text-sm">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-muted">{detail}</p>
        </div>
      </Card>
    );
  }

  const busy = status === 'running' || status === 'preparing';
  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
          {busy ? (
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
          <Button size="sm" className="h-10" onClick={onStop} aria-label="Stop analysis">
            <Square aria-hidden="true" className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        {status === 'paused' && (
          <Button size="sm" variant="primary" className="h-10" onClick={onResume}>
            <Play aria-hidden="true" className="h-3.5 w-3.5" />
            Resume
          </Button>
        )}
        {status === 'failed' && (
          <Button size="sm" className="h-10" onClick={onResume}>
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>
      {status === 'preparing' ? (
        <div
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuetext="Starting"
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div className="h-full w-[8%] animate-pulse rounded-full bg-accent" />
        </div>
      ) : (
        <PassBar analysis={analysis} failed={status === 'failed'} />
      )}
    </Card>
  );
}

interface Segment {
  key: string;
  label: string;
  percent: number;
  state: 'done' | 'active' | 'pending';
}

function passPercent(pass: PassProgress | null): number {
  return pass ? progressPercent(pass) : 0;
}

/** One segment per pass of this analysis, each filled by that pass's progress. */
function segmentsFor({ phase, passes, preset }: AnalysisState): Segment[] {
  const order = ['quick', 'full', 'refining', 'done'] as const;
  const stateOf = (pass: (typeof order)[number]): Segment['state'] => {
    const current = order.indexOf(phase);
    const index = order.indexOf(pass);
    return index < current ? 'done' : index === current ? 'active' : 'pending';
  };
  const percentOf = (pass: (typeof order)[number], progress: PassProgress | null) => {
    const state = stateOf(pass);
    return state === 'done' ? 100 : state === 'active' ? passPercent(progress) : 0;
  };

  const segments: Segment[] = [];
  if (passes.quick) {
    segments.push({
      key: 'quick',
      label: 'Quick review',
      percent: percentOf('quick', passes.quick),
      state: stateOf('quick'),
    });
  }
  segments.push({
    key: 'full',
    label: `Depth ${preset.depth}`,
    // Positions cached from an earlier visit already count while the quick pass runs.
    percent: phase === 'quick' ? passPercent(passes.full) : percentOf('full', passes.full),
    state: stateOf('full'),
  });
  segments.push({
    key: 'refining',
    label: 'Double-check',
    percent: percentOf('refining', passes.refining),
    state: stateOf('refining'),
  });
  return segments;
}

function PassBar({ analysis, failed }: { analysis: AnalysisState; failed: boolean }) {
  const segments = segmentsFor(analysis);
  const active = segments.find((segment) => segment.state === 'active');
  const percent = Math.round(active?.percent ?? 100);
  return (
    <div
      role="progressbar"
      aria-label="Analysis progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={active ? `${active.label}: ${percent}%` : `${percent}%`}
      className="grid gap-x-1.5 gap-y-1.5"
      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
    >
      {segments.map((segment) => (
        <div key={segment.key} className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              failed && segment.state === 'active' ? 'bg-danger' : 'bg-accent',
            )}
            style={{ width: `${segment.percent}%` }}
          />
        </div>
      ))}
      {segments.map((segment) => (
        <span
          key={segment.key}
          aria-hidden="true"
          className={cn(
            'flex min-w-0 items-center gap-1 text-[11px] leading-4',
            segment.state === 'active' ? 'font-medium text-text' : 'text-muted',
          )}
        >
          {segment.state === 'done' && <Check className="h-3 w-3 shrink-0 text-accent" />}
          <span className="truncate">{segment.label}</span>
        </span>
      ))}
    </div>
  );
}
