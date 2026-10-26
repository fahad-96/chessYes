import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GitBranch, Pause, Play, Undo2 } from 'lucide-react';
import type { PositionAnalysis } from '@/core/types';
import { pvToSan, sideToMove } from '@/core/notation';
import { formatScore } from '@/core/winPercent';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { formatLine } from './reviewHelpers';
import type { LiveAnalysisState } from './useLiveAnalysis';
import { numberedMoves, type Variation } from './variation';

export interface VariationPanelProps {
  variation: Variation;
  /** An engine line is playing itself. */
  playing: boolean;
  /** FEN of the position on the board. */
  fen: string;
  live: LiveAnalysisState;
  engineName: string;
  onSeek: (index: number) => void;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  /** Plays an engine line (UCI) from the position on the board. */
  onPlayLine: (pvUci: string[]) => void;
  className?: string;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text transition-colors',
        'hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-35',
        'focus-visible:outline-2 focus-visible:outline-accent',
      )}
    >
      {children}
    </button>
  );
}

const TERMINAL_TEXT: Record<NonNullable<PositionAnalysis['terminal']>, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate: a draw',
  insufficient: 'Draw: neither side can mate',
  threefold: 'Draw by repetition',
  'fifty-move': 'Draw by the fifty-move rule',
};

/** "+0.4" for the position, or the result once the game is over on the board. */
function evalLabel(analysis: PositionAnalysis | null): string | null {
  if (!analysis) return null;
  if (analysis.terminal === 'checkmate') return sideToMove(analysis.fen) === 'w' ? '0-1' : '1-0';
  if (analysis.terminal) return '½-½';
  const best = analysis.lines[0];
  return best ? formatScore(best.score) : null;
}

/** The variation being explored (or an engine line), with live engine lines for its position. */
export function VariationPanel({
  variation,
  playing,
  fen,
  live,
  engineName,
  onSeek,
  onStep,
  onTogglePlay,
  onClose,
  onPlayLine,
  className,
}: VariationPanelProps) {
  const isLine = variation.kind === 'line';
  const atStart = variation.index === 0;
  const atEnd = variation.index >= variation.moves.length;
  const analysis = live.analysis;
  const score = evalLabel(analysis);
  const fullMove = Number(fen.split(' ')[5]) || 1;
  const toMove = sideToMove(fen);

  return (
    <Card
      aria-label={isLine ? (variation.title ?? 'Engine line') : 'Variation'}
      className={cn('flex flex-col gap-3 p-3 sm:p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <GitBranch aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate">
            {isLine ? (variation.title ?? 'Engine line') : 'Variation'}
          </span>
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={onClose}
          className="h-10 shrink-0 sm:h-8"
          aria-keyshortcuts="Escape"
          title="Back to game (Esc)"
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
          Back to game
        </Button>
      </div>

      <ol aria-label="Variation moves" className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {numberedMoves(variation.moves).map((move) => {
          const current = move.index === variation.index;
          return (
            <li key={move.index} className="flex items-center">
              {move.number && (
                <span aria-hidden="true" className="tabular pr-0.5 pl-1 text-xs text-muted">
                  {move.number}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSeek(move.index)}
                aria-current={current ? 'step' : undefined}
                aria-label={`${move.number ?? ''} ${move.san}`.trim()}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-md px-1.5 text-sm transition-colors lg:min-h-8',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  current ? 'bg-accent/20 font-semibold text-text' : 'hover:bg-surface-2',
                )}
              >
                {move.san}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-1 border-t border-line pt-2">
        <IconButton
          label="Previous move in variation"
          onClick={() => onStep(-1)}
          disabled={atStart}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </IconButton>
        {isLine && (
          <IconButton label={playing ? 'Pause' : 'Play line'} onClick={onTogglePlay}>
            {playing ? (
              <Pause aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
          </IconButton>
        )}
        <IconButton label="Next move in variation" onClick={() => onStep(1)} disabled={atEnd}>
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </IconButton>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted">
          {live.running && <Spinner className="h-3 w-3" label="Analysing" />}
          <span className="truncate">
            {analysis && !analysis.terminal && analysis.depth > 0
              ? `Depth ${analysis.depth}`
              : live.running
                ? 'Analysing…'
                : ''}
          </span>
          {score && (
            <span
              className="tabular rounded-md bg-surface-2 px-2 py-1 text-sm font-semibold text-text"
              aria-label={`Evaluation ${score}`}
            >
              {score}
            </span>
          )}
        </div>
      </div>

      <div aria-label={`${engineName} lines`} className="-mt-1 flex flex-col">
        {live.error ? (
          <p className="text-sm text-danger">The engine could not analyse this position.</p>
        ) : analysis?.terminal ? (
          <p className="text-sm text-muted">{TERMINAL_TEXT[analysis.terminal]}</p>
        ) : analysis && analysis.lines.length > 0 ? (
          analysis.lines.map((line, index) => {
            const sans = pvToSan(fen, line.pv);
            if (sans.length === 0) return null;
            const text = formatLine(sans, fullMove, toMove, 10);
            const lineScore = formatScore(line.score);
            return (
              <button
                key={`${index}-${line.pv[0]}`}
                type="button"
                onClick={() => onPlayLine(line.pv)}
                aria-label={`Play ${lineScore}: ${text}`}
                className={cn(
                  'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm transition-colors',
                  'hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent',
                )}
              >
                <span className="tabular w-12 shrink-0 rounded bg-surface-2 px-1 py-0.5 text-center text-xs font-semibold">
                  {lineScore}
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-muted">{text}</span>
              </button>
            );
          })
        ) : (
          <p className="flex min-h-10 items-center text-sm text-muted">
            {live.running ? `${engineName} is thinking…` : 'No engine lines yet.'}
          </p>
        )}
      </div>
    </Card>
  );
}
